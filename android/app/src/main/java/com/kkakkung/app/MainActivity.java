package com.kkakkung.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * **여기서 하는 일은 알림 채널을 만드는 것 하나뿐이다.**
 *
 * 아이폰은 발송기가 `aps.sound`에 파일 이름만 적으면 끝나는데
 * (`supabase/functions/notify`의 `APNS_SOUND`), **안드로이드는 8부터
 * 알림음이 payload가 아니라 `채널`에 박힌다** — 그래서 소리를 물린 채널을
 * 앱이 미리 만들어 두고, 발송기는 그 `channel_id`를 가리키기만 한다.
 *
 * **JS에서 만들지 않고 여기서 만든다.** 플러그인에도
 * `PushNotifications.createChannel()`이 있지만 그것은 **웹 화면이 떠서
 * 그 줄이 돌아야** 생긴다 — 앱을 새로 깐 사람이 앱을 열기 전에 알림이
 * 먼저 닿으면 채널이 없어 **기본음으로 뜬다.** `onCreate`는 화면보다
 * 먼저, 알림을 켰든 안 켰든 늘 도는 자리다.
 *
 * **한 번 만들어진 채널의 소리는 앱이 못 바꾼다** — 사람이 설정에서
 * 바꿔 둔 것을 앱이 덮지 못하게 안드로이드가 막아 둔 것이라, 이름과
 * 설명만 갱신된다. **소리를 바꾸려면 채널 id를 새로 만드는 수밖에
 * 없다**(`res/values/notify.xml`의 `_v1`을 올린다).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* **앱 안에 넣어 둔 플러그인은 손으로 등록해야 한다** — Capacitor는
           npm으로 깐 것만 스스로 찾는다(아이폰에서 첫판이 통째로 막혔던 자리.
           `MainViewController.swift`의 `registerPluginInstance`와 같다).
           `super.onCreate` **앞**이어야 다리가 만들어질 때 함께 실린다. */
        registerPlugin(com.kkakkung.app.chat.NativeChatPlugin.class);
        registerPlugin(com.kkakkung.app.nav.NativeNavPlugin.class);
        registerPlugin(com.kkakkung.app.nativev2.NativeAppPlugin.class);
        super.onCreate(savedInstanceState);
        /* **화면 전환·뒤로 끌기를 맡는 층에 웹뷰를 담는다**(`nav/NavLayer.kt`).
           `super.onCreate`가 웹뷰를 세운 **뒤**여야 한다. 그리고 여기서 거는
           뒤로 단추 처리가 `@capacitor/app`의 것보다 **나중에 걸려야** 이긴다 —
           안드로이드는 마지막에 건 것부터 본다. 층이 꺼져 있는 화면(탭)에서는
           그 처리를 꺼 두므로 예전처럼 웹뷰 히스토리로 간다. */
        if (getBridge() != null && getBridge().getWebView() != null) {
            com.kkakkung.app.nav.NavLayer.Companion.install(this, getBridge().getWebView());
        }
        createNotifyChannel();
    }

    private void createNotifyChannel() {
        // 안드로이드 8 미만에는 채널이라는 것이 없다 — 그때는 발송기가
        // 함께 실어 보내는 `sound`를 폰이 그대로 쓴다.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        NotificationChannel ch = new NotificationChannel(
                getString(R.string.notify_channel_id),
                getString(R.string.notify_channel_name),
                // **`HIGH`여야 화면 위로 배너가 뜬다.** `DEFAULT`면 소리는
                // 나도 알림창에 조용히 쌓이기만 해 새벽 라운드 알림을 놓친다.
                NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(getString(R.string.notify_channel_desc));
        ch.enableVibration(true);

        /* **파일 이름이 아니라 리소스 번호로 가리킨다**(`R.raw.kkakkung`) —
           글자로 적으면 파일을 지웠을 때 빌드는 초록인데 폰에서만 조용히
           기본음이 난다. 번호로 적으면 그 자리에서 빌드가 선다. */
        Uri sound = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.kkakkung);
        ch.setSound(sound, new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build());

        nm.createNotificationChannel(ch);
    }
}
