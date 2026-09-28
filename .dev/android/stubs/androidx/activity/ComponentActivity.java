package androidx.activity;
import androidx.activity.result.*; import androidx.activity.result.contract.*;
public class ComponentActivity extends android.app.Activity implements androidx.lifecycle.LifecycleOwner {
  private final OnBackPressedDispatcher obd = new OnBackPressedDispatcher();
  public final OnBackPressedDispatcher getOnBackPressedDispatcher() { return obd; }
  public final <I,O> ActivityResultLauncher<I> registerForActivityResult(ActivityResultContract<I,O> c, ActivityResultCallback<O> cb) { return null; }
  public androidx.lifecycle.Lifecycle getLifecycle() { return null; }
}
