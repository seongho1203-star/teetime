package com.kkakkung.app.chat

import coil.decode.VideoFrameDecoder
import coil.request.ImageRequest
import coil.request.videoFrameMillis

/** Force video decoding for picker content URIs and signed URLs without usable MIME types. */
internal fun ImageRequest.Builder.chatVideoFrame(video: Boolean) {
    if (video) {
        videoFrameMillis(0)
        decoderFactory { result, options, _ -> VideoFrameDecoder(result.source, options) }
    }
}
