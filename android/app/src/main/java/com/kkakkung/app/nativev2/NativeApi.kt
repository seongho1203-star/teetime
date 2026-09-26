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
        /* 앱을 오래 켜 둬도 WebView에게 토큰 갱신을 부탁하지 않는다. */
        if (session.needsRefresh) NativeAuth.refresh(session)
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

    suspend fun privateProfile(): JSONObject? = try {
        rows("profile_private", listOf("select" to "*", "id" to "eq.${session.userId}", "limit" to "1")).firstOrNull()
    } catch (_: Exception) { null }

    suspend fun uploadAvatar(jpeg: ByteArray): String = withContext(Dispatchers.IO) {
        if (session.needsRefresh) NativeAuth.refresh(session)
        val path = "${session.userId}/${System.currentTimeMillis()}.jpg"
        val url = session.supabaseUrl.trimEnd('/') + "/storage/v1/object/avatars/" + enc(path)
        val req = Request.Builder().url(url)
            .header("apikey", session.anonKey)
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("Content-Type", "image/jpeg")
            .header("x-upsert", "false")
            .post(jpeg.toRequestBody("image/jpeg".toMediaType()))
            .build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw NativeApiError("프로필 사진을 올리지 못했습니다.")
        }
        val publicUrl = session.supabaseUrl.trimEnd('/') +
            "/storage/v1/object/public/avatars/" + path.split('/').joinToString("/") { enc(it) }
        val changed = request("rest/v1/profiles", listOf("id" to "eq.${session.userId}"), "PATCH",
            JSONObject().put("avatar_url", publicUrl))
        if ((changed as? JSONArray)?.length() == 0) throw NativeApiError("프로필 사진을 저장하지 못했습니다.")
        publicUrl
    }

    suspend fun updateMyProfile(
        name: String, gender: String, birthYear: Int, region: String,
        phone: String, car: String, birthMd: String? = null, birthCal: String? = null
    ) {
        val pub = request("rest/v1/profiles", listOf("id" to "eq.${session.userId}"), "PATCH",
            JSONObject().put("name", name).put("gender", gender)
                .put("birth_year", birthYear).put("region", region))
        if ((pub as? JSONArray)?.length() == 0) throw NativeApiError("프로필을 저장하지 못했습니다.")

        val priv = JSONObject().put("id", session.userId).put("phone", phone).put("car", car)
        if (!birthMd.isNullOrBlank()) priv.put("birth_md", birthMd)
        if (!birthCal.isNullOrBlank()) priv.put("birth_cal", birthCal)

        /* PATCH는 행이 없어도 204/[]라 예외가 안 난다. 응답 길이로 upsert한다. */
        val patched = request("rest/v1/profile_private",
            listOf("id" to "eq.${session.userId}"), "PATCH", priv)
        if ((patched as? JSONArray)?.length() == 0) {
            request("rest/v1/profile_private", method = "POST", body = priv)
        }
    }

    suspend fun ensurePendingProfile(name: String = ""): JSONObject {
        profile()?.let { return it }
        val made = request("rest/v1/profiles", method = "POST", body = JSONObject()
            .put("id", session.userId).put("name", name).put("role", "pending"))
        return firstObject(made) ?: throw NativeApiError("가입 신청 정보를 만들지 못했습니다.")
    }

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
            "select" to "id,title,course,tee_at,capacity,fee,status,kind,caddie,cart,signups(user_id,state,seq,grp)",
            "status" to "neq.cancelled",
            /* 홈의 '다가오는 라운드'에 이미 지난 라운드(실기기에서 9/23)가
               다시 보이던 오류. 현재 시각 이후만 받는다. */
            "tee_at" to "gte.${java.time.Instant.now()}",
            "order" to "tee_at.asc", "limit" to limit.toString()
        ))

    suspend fun rounds(limit: Int = 60): List<JSONObject> =
        rows("rounds", listOf(
            "select" to "id,title,course,tee_at,capacity,fee,status,kind,caddie,cart,signups(user_id,state,seq,grp)",
            "order" to "tee_at.desc", "limit" to limit.toString()
        ))

    suspend fun openPolls(limit: Int = 30): List<JSONObject> =
        rows("polls", listOf(
            "select" to "id,title,body,multi,anonymous,closes_at,closed,created_at,poll_options(id,label,sort),poll_votes(option_id,user_id)",
            "closed" to "eq.false", "order" to "created_at.desc", "limit" to limit.toString()
        ))

    suspend fun polls(limit: Int = 60): List<JSONObject> =
        rows("polls", listOf(
            "select" to "id,title,body,multi,anonymous,closes_at,closed,created_at,poll_options(id,label,sort),poll_votes(option_id,user_id)",
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

    suspend fun updatePoll(
        id: String, title: String, bodyText: String, multi: Boolean,
        anonymous: Boolean, closesAt: String, labels: List<String>
    ) {
        val before = poll(id) ?: throw NativeApiError("투표를 찾지 못했습니다.")
        val old = buildList {
            val a = before.optJSONArray("poll_options") ?: JSONArray()
            for (i in 0 until a.length()) a.optJSONObject(i)?.let(::add)
        }.sortedBy { it.optInt("sort") }
        val votes = buildList {
            val a = before.optJSONArray("poll_votes") ?: JSONArray()
            for (i in 0 until a.length()) a.optJSONObject(i)?.let(::add)
        }
        val locked = votes.isNotEmpty()
        val patch = JSONObject().put("title", title).put("body", bodyText).put("closes_at", closesAt)
        if (!locked) patch.put("multi", multi).put("anonymous", anonymous)
        request("rest/v1/polls", listOf("id" to "eq.$id"), "PATCH", patch)

        labels.forEachIndexed { i, label ->
            if (i < old.size) {
                request("rest/v1/poll_options", listOf("id" to "eq.${old[i].optString("id")}"), "PATCH",
                    JSONObject().put("label", label).put("sort", i))
            } else {
                request("rest/v1/poll_options", method = "POST",
                    body = JSONObject().put("poll_id", id).put("label", label).put("sort", i))
            }
        }
        if (labels.size < old.size) {
            old.drop(labels.size).forEach { option ->
                val oid = option.optString("id")
                if (votes.any { it.optString("option_id") == oid })
                    throw NativeApiError("표가 들어온 항목은 먼저 유지해 주세요.")
                request("rest/v1/poll_options", listOf("id" to "eq.$oid"), "DELETE")
            }
        }
    }

    suspend fun togglePollClosed(id: String, shut: Boolean, oldClose: String?) {
        val patch = JSONObject().put("closed", !shut)
        if (shut && !oldClose.isNullOrBlank()) {
            try {
                if (java.time.OffsetDateTime.parse(oldClose).toInstant().isBefore(java.time.Instant.now()))
                    patch.put("closes_at", JSONObject.NULL)
            } catch (_: Exception) {}
        }
        request("rest/v1/polls", listOf("id" to "eq.$id"), "PATCH", patch)
    }

    suspend fun deletePoll(id: String) {
        val v = request("rest/v1/polls", listOf("id" to "eq.$id"), "DELETE")
        if ((v as? JSONArray)?.length() == 0) throw NativeApiError("투표를 지울 권한이 없습니다.")
    }

    // ── 공지 ───────────────────────────────────────────────────

    suspend fun posts(): List<JSONObject> =
        rows("posts", listOf("select" to "*", "order" to "pinned.desc,created_at.desc", "limit" to "200"))

    suspend fun post(id: String): JSONObject? =
        rows("posts", listOf("select" to "*", "id" to "eq.$id", "limit" to "1")).firstOrNull()

    suspend fun postComments(id: String): List<JSONObject> =
        rows("post_comments", listOf(
            "select" to "*", "post_id" to "eq.$id", "order" to "created_at.asc", "limit" to "500"
        ))

    suspend fun createPost(title: String, bodyText: String, pinned: Boolean): String {
        val v = request("rest/v1/posts", method = "POST", body = JSONObject()
            .put("title", title).put("body", bodyText).put("pinned", pinned).put("author_id", session.userId))
        return firstObject(v)?.optString("id").orEmpty().ifBlank { throw NativeApiError("공지를 올리지 못했습니다.") }
    }

    suspend fun updatePost(id: String, title: String, bodyText: String, pinned: Boolean) {
        val v = request("rest/v1/posts", listOf("id" to "eq.$id"), "PATCH", JSONObject()
            .put("title", title).put("body", bodyText).put("pinned", pinned)
            .put("updated_at", java.time.Instant.now().toString()))
        if ((v as? JSONArray)?.length() == 0) throw NativeApiError("공지를 수정할 권한이 없습니다.")
    }

    suspend fun togglePostPin(id: String, pinned: Boolean) {
        request("rest/v1/posts", listOf("id" to "eq.$id"), "PATCH", JSONObject().put("pinned", pinned))
    }

    suspend fun deletePost(id: String) {
        val v = request("rest/v1/posts", listOf("id" to "eq.$id"), "DELETE")
        if ((v as? JSONArray)?.length() == 0) throw NativeApiError("공지를 지울 권한이 없습니다.")
    }

    // ── 정산 현황 ───────────────────────────────────────────────

    suspend fun settlements(limit: Int = 30): List<JSONObject> = try {
        rows("settlements", listOf(
            "select" to "id,round_id,title,total,created_by,created_at,settlement_shares(id,settlement_id,user_id,amount,paid)",
            "order" to "created_at.desc", "limit" to limit.toString()
        ))
    } catch (_: Exception) { emptyList() }

    suspend fun createSettlement(
        roundId: String, title: String, note: String, bank: String, account: String,
        amounts: Map<String, Int>
    ): String {
        if (amounts.isEmpty()) throw NativeApiError("정산할 사람을 골라 주세요.")
        val total = amounts.values.sum()
        val made = request("rest/v1/settlements", method = "POST", body = JSONObject()
            .put("round_id", roundId).put("title", title).put("body", note)
            .put("bank", bank).put("account", account).put("total", total)
            .put("created_by", session.userId))
        val id = firstObject(made)?.optString("id").orEmpty()
        if (id.isBlank()) throw NativeApiError("정산을 만들지 못했습니다.")
        val shares = JSONArray()
        amounts.forEach { (uid, amount) ->
            shares.put(JSONObject().put("settlement_id", id).put("user_id", uid).put("amount", amount))
        }
        try {
            request("rest/v1/settlement_shares", method = "POST", body = shares)
        } catch (e: Exception) {
            try { request("rest/v1/settlements", listOf("id" to "eq.$id"), "DELETE") } catch (_: Exception) {}
            throw e
        }
        return id
    }

    suspend fun deleteSettlement(id: String) {
        val v = request("rest/v1/settlements", listOf("id" to "eq.$id"), "DELETE")
        if ((v as? JSONArray)?.length() == 0) throw NativeApiError("정산을 지울 권한이 없습니다.")
    }

    suspend fun markSharePaid(id: String, paid: Boolean = true) {
        val v = request("rest/v1/settlement_shares", listOf("id" to "eq.$id"), "PATCH",
            JSONObject().put("paid", paid))
        if ((v as? JSONArray)?.length() == 0) throw NativeApiError("입금 상태를 바꿀 권한이 없습니다.")
    }

    suspend fun remindSettlement(id: String) {
        request("rest/v1/settle_reminders", method = "POST", body = JSONObject().put("settlement_id", id))
    }

    suspend fun roundNames(ids: List<String>): Map<String, String> {
        if (ids.isEmpty()) return emptyMap()
        val rows = rows("rounds", listOf(
            "select" to "id,course,title",
            "id" to "in.(${ids.joinToString(",")})"
        ))
        return rows.associate { it.optString("id") to it.optString("course").ifBlank { it.optString("title") } }
    }

    suspend fun castVote(optionId: String) {
        request("rest/v1/rpc/cast_vote", method = "POST", body = JSONObject().put("p_option", optionId))
    }

    suspend fun retractVote(optionId: String) {
        request("rest/v1/rpc/retract_vote", method = "POST", body = JSONObject().put("p_option", optionId))
    }

    // ── 알림 · 회원 관리 ───────────────────────────────────────

    suspend fun pushEnabled(token: String): Boolean = try {
        rows("push_subscriptions", listOf(
            "select" to "endpoint",
            "endpoint" to "eq.fcm:$token",
            "limit" to "1"
        )).isNotEmpty()
    } catch (_: Exception) { false }

    suspend fun enablePush(token: String) = withContext(Dispatchers.IO) {
        if (session.needsRefresh) NativeAuth.refresh(session)
        val endpoint = "fcm:$token"
        val url = session.supabaseUrl.trimEnd('/') + "/rest/v1/push_subscriptions?on_conflict=endpoint"
        val payload = JSONObject()
            .put("endpoint", endpoint).put("user_id", session.userId)
            .put("p256dh", "").put("auth", "").put("ua", "android-native-v2")
        val req = Request.Builder().url(url)
            .header("apikey", session.anonKey)
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates,return=representation")
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw NativeApiError("알림을 서버에 등록하지 못했습니다.")
        }
    }

    suspend fun disablePush(token: String) {
        request("rest/v1/push_subscriptions", listOf("endpoint" to "eq.fcm:$token"), "DELETE")
    }

    suspend fun unreadAlertCount(): Int = try {
        rows("notifications", listOf(
            "select" to "id", "read_at" to "is.null", "limit" to "100"
        )).size
    } catch (_: Exception) { 0 }

    suspend fun pendingCount(): Int = try {
        rows("profiles", listOf("select" to "id", "role" to "eq.pending", "limit" to "100")).size
    } catch (_: Exception) { 0 }

    suspend fun notifications(limit: Int = 50): List<JSONObject> = try {
        rows("notifications", listOf("select" to "*", "order" to "created_at.desc", "limit" to limit.toString()))
    } catch (_: Exception) { emptyList() }

    suspend fun markNotificationsRead() {
        try {
            request("rest/v1/notifications", listOf("read_at" to "is.null"), "PATCH",
                JSONObject().put("read_at", java.time.Instant.now().toString()))
        } catch (_: Exception) {}
    }

    suspend fun purgeNotifications() {
        try { request("rest/v1/rpc/purge_my_notifications", method = "POST", body = JSONObject()) }
        catch (_: Exception) {}
    }

    suspend fun contacts(): List<JSONObject> = try {
        rows("profile_private", listOf("select" to "*", "limit" to "1000"))
    } catch (_: Exception) { emptyList() }

    suspend fun setMemberRole(id: String, role: String) {
        val v = request("rest/v1/profiles", listOf("id" to "eq.$id"), "PATCH", JSONObject().put("role", role))
        if ((v as? JSONArray)?.length() == 0) throw NativeApiError("회원 등급을 바꿀 권한이 없습니다.")
    }

    suspend fun rejectMember(id: String) {
        val v = request("rest/v1/profiles", listOf("id" to "eq.$id"), "DELETE")
        if ((v as? JSONArray)?.length() == 0) throw NativeApiError("가입 신청을 거절할 권한이 없습니다.")
    }
}
