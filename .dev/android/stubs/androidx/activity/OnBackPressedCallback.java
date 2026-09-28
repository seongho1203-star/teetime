package androidx.activity;
public abstract class OnBackPressedCallback {
  public OnBackPressedCallback(boolean enabled) {}
  public final boolean isEnabled() { return true; }
  public final void setEnabled(boolean e) {}
  public final void remove() {}
  public abstract void handleOnBackPressed();
  public void handleOnBackStarted(BackEventCompat e) {}
  public void handleOnBackProgressed(BackEventCompat e) {}
  public void handleOnBackCancelled() {}
}
