package androidx.appcompat.app;
import android.content.*; import android.view.View;
public class AlertDialog extends android.app.Dialog implements DialogInterface {
  protected AlertDialog(Context c) { super(c); }
  public android.widget.Button getButton(int which) { return null; }
  public void setMessage(CharSequence m) {}
  public static class Builder {
    public Builder(Context c) {} public Builder(Context c, int theme) {}
    public Builder setTitle(CharSequence t) { return this; } public Builder setTitle(int t) { return this; }
    public Builder setMessage(CharSequence m) { return this; }
    public Builder setView(View v) { return this; }
    public Builder setPositiveButton(CharSequence t, DialogInterface.OnClickListener l) { return this; }
    public Builder setNegativeButton(CharSequence t, DialogInterface.OnClickListener l) { return this; }
    public Builder setNeutralButton(CharSequence t, DialogInterface.OnClickListener l) { return this; }
    public Builder setItems(CharSequence[] items, DialogInterface.OnClickListener l) { return this; }
    public Builder setSingleChoiceItems(CharSequence[] items, int checked, DialogInterface.OnClickListener l) { return this; }
    public Builder setMultiChoiceItems(CharSequence[] items, boolean[] checked, DialogInterface.OnMultiChoiceClickListener l) { return this; }
    public Builder setCancelable(boolean c) { return this; }
    public Builder setOnDismissListener(DialogInterface.OnDismissListener l) { return this; }
    public Builder setOnCancelListener(DialogInterface.OnCancelListener l) { return this; }
    public AlertDialog create() { return null; } public AlertDialog show() { return null; }
  }
}
