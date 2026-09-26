package com.kkakkung.app.nativev2

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class NativeApiError(message: String) : Exception(message)

/** Android Native V2 공통 Supabase 클라이언트.
 *
 * service_role은 사용하지 않는다. 회원 JWT + anon key만 보내므로 기존 웹과
 * 똑같은 RLS/RPC 규칙이 적용된다. iOS NativeAppData.swift와 같은 계약을 쓴다.
 */
class NativeApi(private val session: NativeSession) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private fun enc(v: String) = URLEncoder.encode(v, "UTF-8").replace("+", "%20")

    suspend fun request(
        path: String,
        query: List<Pair<String, String>> = emptyList(),
        method: String = "GET",
        body: Any? = null
    ): Any? = withContext(Dispatchers.IO) {
        val qs = query.joinToString("&") { enc(it.first) + "=" + enc(it.second) }
        val base = session.supabaseUrl.trimEnd('/')
        val url = "$base/$path" + if (qs.isEmpty()) "" else "?$qs"
        val payload = when {
            body != null -> body.toString().toRequestBody("application/json".toMediaType())
            method == "POST" || method == "PATCH" || method == "DELETE" ->
                "".toRequestBody("application/json".toMediaType())
            else -> null
        }
        val req = Request.Builder().url(url)
            .header("apikey", session.anonKey)
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("Accept", "application/json")
            .header("Prefer", "return=representation")
            .method(method, payload)
            .build()
        http.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (res.code == 401) throw NativeApiError("로그인이 만료됐습니다.")
            if (res.code == 403) throw NativeApiError("이 작업을 할 권한이 없습니다.")
            if (!res.isSuccessful) {
                val message = try {
                    JSONObject(raw).optString("message").ifBlank { "서버 오류(${res.code})" }
                } catch (_: Exception) { "서버 오류(${res.code})" }
                throw NativeApiError(message)
            }
            if (raw.isBlank()) JSONArray() else JSONTokener(raw).nextValue()
        }
    }

    suspend fun rows(
        table: String,
        query: List<Pair<String, String>> = emptyList()
    ): List<JSONObject> {
        val arr = request("rest/v1/$table", query) as? JSONArray ?: JSONArray()
        return buildList {
            for (i in 0 until arr.length()) arr.optJSONObject(i)?.let(::add)
        }
    }

    private fun firstObject(value: Any?): JSONObject? = when (value) {
        is JSONObject -> value
        is JSONArray -> value.optJSONObject(0)
        else -> null
    }

    suspend fun profile(): JSONObject? =
        rows("profiles", listOf("select" to "*", "id" to "eq.${session.userId}", "limit" to "1")).firstOrNull()

    suspend fun people(): List<JSONObject> = try {
        rows("profiles", listOf(
            "select" to "id,name,avatar_url,role,gender,birth_year,region",
            "order" to "name", "limit" to "1000"
        ))
    } catch (_: Exception) {
        rows("profiles", listOf("select" to "id,name,avatar_url,role", "order" to "name", "limit" to "1000"))
    }

    suspend fun upcomingRounds(limit: Int = 30): List<JSONObject> =
        rows("rounds", listOf(
            "select" to "id,title,course,tee_at,capacity,fee,status,kind,caddie,cart",
            "status" to "neq.cancelled", "order" to "tee_at.asc", "limit" to limit.toString()
        ))

    suspend fun rounds(limit: Int = 60): List<JSONObject> =
        rows("rounds", listOf(
            "select" to "id,title,course,tee_at,capacity,fee,status,kind,caddie,cart",
            "order" to "tee_at.desc", "limit" to limit.toString()
        ))

    suspend fun openPolls(limit: Int = 30): List<JSONObject> =
        rows("polls", listOf(
            "select" to "id,title,body,multi,anonymous,closes_at,closed,created_at",
            "closed" to "eq.false", "order" to "created_at.desc", "limit" to limit.toString()
        ))

    suspend fun polls(limit: Int = 60): List<JSONObject> =
        rows("polls", listOf(
            "select" to "id,title,body,multi,anonymous,closes_at,closed,created_at",
            "order" to "created_at.desc", "limit" to limit.toString()
        ))

    /** 라운드 상세 — 신청을 딸려 받아 정원/내 상태를 한 응답으로 맞춘다. */
    suspend fun round(id: String): JSONObject? =
        rows("rounds", listOf("select" to "*,signups(*)", "id" to "eq.$id", "limit" to "1")).firstOrNull()

    suspend fun roundComments(id: String): List<JSONObject> =
        rows("round_comments", listOf(
            "select" to "*", "round_id" to "eq.$id", "order" to "created_at.asc", "limit" to "500"
        ))

    suspend fun joinRound(id: String): String? {
        val v = request("rest/v1/rpc/join_round", method = "POST",
            body = JSONObject().put("p_round", id).put("p_note", ""))
        return firstObject(v)?.optString("state")
    }

    suspend fun leaveRound(id: String) {
        request("rest/v1/rpc/leave_round", method = "POST", body = JSONObject().put("p_round", id))
    }

    suspend fun kickSignup(round: String, user: String) {
        request("rest/v1/rpc/kick_signup", method = "POST",
            body = JSONObject().put("p_round", round).put("p_user", user))
    }

    suspend fun addComment(table: String, parentKey: String, parentId: String, body: String) {
        request("rest/v1/$table", method = "POST",
            body = JSONObject().put(parentKey, parentId).put("author_id", session.userId).put("body", body))
    }

    suspend fun deleteRow(table: String, id: String) {
        val v = request("rest/v1/$table", listOf("id" to "eq.$id"), "DELETE")
        if ((v as? JSONArray)?.length() == 0) throw NativeApiError("권한이 없거나 이미 지워졌습니다.")
    }

    suspend fun setRoundStatus(id: String, status: String) {
        val v = request("rest/v1/rounds", listOf("id" to "eq.$id"), "PATCH",
            JSONObject().put("status", status))
        if ((v as? JSONArray)?.length() == 0) throw NativeApiError("권한이 없습니다.")
    }

    suspend fun poll(id: String): JSONObject? =
        rows("polls", listOf(
            "select" to "*,poll_options(id,label,sort),poll_votes(option_id,user_id)",
            "id" to "eq.$id", "limit" to "1"
        )).firstOrNull()

    suspend fun pollComments(id: String): List<JSONObject> =
        rows("poll_comments", listOf(
            "select" to "*", "poll_id" to "eq.$id", "order" to "created_at.asc", "limit" to "500"
        ))

    suspend fun createRound(fields: JSONObject): String {
        fields.put("created_by", session.userId)
        val v = request("rest/v1/rounds", method = "POST", body = fields)
        return firstObject(v)?.optString("id").orEmpty().ifBlank {
            throw NativeApiError("라운드를 만들지 못했습니다.")
        }
    }

    suspend fun updateRound(id: String, fields: JSONObject) {
        val v = request("rest/v1/rounds", listOf("id" to "eq.$id"), "PATCH", fields)
        if ((v as? JSONArray)?.length() == 0) throw NativeApiError("라운드를 수정할 권한이 없습니다.")
    }

    suspend fun setRoundGroups(roundId: String, groups: JSONObject, tees: JSONObject = JSONObject()) {
        request("rest/v1/rpc/set_round_groups", method = "POST",
            body = JSONObject().put("p_round", roundId).put("p_grps", groups).put("p_tees", tees))
    }

    suspend fun createPoll(
        title: String, bodyText: String, multi: Boolean, anonymous: Boolean,
        closesAt: String, labels: List<String>
    ): String {
        val poll = JSONObject()
            .put("title", title).put("body", bodyText).put("multi", multi)
            .put("anonymous", anonymous).put("closes_at", closesAt)
            .put("created_by", session.userId)
        val created = request("rest/v1/polls", method = "POST", body = poll)
        val id = firstObject(created)?.optString("id").orEmpty()
        if (id.isBlank()) throw NativeApiError("투표를 만들지 못했습니다.")
        val options = JSONArray()
        labels.forEachIndexed { i, label ->
            options.put(JSONObject().put("poll_id", id).put("label", label).put("sort", i))
        }
        try {
            request("rest/v1/poll_options", method = "POST", body = options)
        } catch (e: Exception) {
            try { request("rest/v1/polls", listOf("id" to "eq.$id"), "DELETE") } catch (_: Exception) {}
            throw e
        }
        return id
    }

    suspend fun castVote(optionId: String) {
        request("rest/v1/rpc/cast_vote", method = "POST", body = JSONObject().put("p_option", optionId))
    }

    suspend fun retractVote(optionId: String) {
        request("rest/v1/rpc/retract_vote", method = "POST", body = JSONObject().put("p_option", optionId))
    }
}
