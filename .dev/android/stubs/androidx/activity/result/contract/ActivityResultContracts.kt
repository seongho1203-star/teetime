package androidx.activity.result.contract
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.ActivityResult
import androidx.activity.result.PickVisualMediaRequest
class ActivityResultContracts private constructor() {
    open class StartActivityForResult : ActivityResultContract<Intent, ActivityResult>() {
        override fun createIntent(c: Context, i: Intent): Intent = i
        override fun parseResult(r: Int, i: Intent?): ActivityResult = TODO()
    }
    open class RequestPermission : ActivityResultContract<String, Boolean>() {
        override fun createIntent(c: Context, i: String): Intent = TODO()
        override fun parseResult(r: Int, i: Intent?): Boolean = false
    }
    open class GetContent : ActivityResultContract<String, Uri?>() {
        override fun createIntent(c: Context, i: String): Intent = TODO()
        override fun parseResult(r: Int, i: Intent?): Uri? = null
    }
    open class PickVisualMedia : ActivityResultContract<PickVisualMediaRequest, Uri?>() {
        sealed interface VisualMediaType
        object ImageAndVideo : VisualMediaType
        object ImageOnly : VisualMediaType
        object VideoOnly : VisualMediaType
        override fun createIntent(c: Context, i: PickVisualMediaRequest): Intent = TODO()
        override fun parseResult(r: Int, i: Intent?): Uri? = null
    }
    open class PickMultipleVisualMedia(val max: Int = 20) : ActivityResultContract<PickVisualMediaRequest, List<Uri>>() {
        override fun createIntent(c: Context, i: PickVisualMediaRequest): Intent = TODO()
        override fun parseResult(r: Int, i: Intent?): List<Uri> = emptyList()
    }
}
