package androidx.fragment.app;
public class DialogFragment extends Fragment {
  public void dismiss() {} public void dismissAllowingStateLoss() {}
  public void show(FragmentManager m, String tag) {} public void showNow(FragmentManager m, String tag) {}
  public android.app.Dialog onCreateDialog(android.os.Bundle b) { return null; }
  public android.app.Dialog getDialog() { return null; } public final android.app.Dialog requireDialog() { return null; }
  public void setStyle(int style, int theme) {} public void setCancelable(boolean c) {}
  public void onDismiss(android.content.DialogInterface d) {} public void onCancel(android.content.DialogInterface d) {}
  public static final int STYLE_NORMAL = 0; public static final int STYLE_NO_TITLE = 1; public static final int STYLE_NO_FRAME = 2;
}
