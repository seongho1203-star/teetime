package androidx.core.app;
public class NotificationCompat {
  public static final int PRIORITY_HIGH = 1; public static final int PRIORITY_DEFAULT = 0;
  public abstract static class Style {}
  public static class BigTextStyle extends Style { public BigTextStyle bigText(CharSequence c) { return this; } }
  public static class Builder {
    public Builder(android.content.Context c, String ch) {}
    public Builder setSmallIcon(int i) { return this; } public Builder setContentTitle(CharSequence t) { return this; } public Builder setContentText(CharSequence t) { return this; }
    public Builder setStyle(Style s) { return this; } public Builder setContentIntent(android.app.PendingIntent p) { return this; } public Builder setAutoCancel(boolean b) { return this; }
    public Builder setPriority(int p) { return this; } public Builder setColor(int c) { return this; } public Builder setSound(android.net.Uri u) { return this; } public Builder setNumber(int n) { return this; }
    public android.app.Notification build() { return null; }
  }
}
