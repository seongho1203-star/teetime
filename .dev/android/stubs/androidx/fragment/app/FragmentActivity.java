package androidx.fragment.app;
public class FragmentActivity extends androidx.activity.ComponentActivity {
  private final FragmentManager fm = new FragmentManager();
  public FragmentManager getSupportFragmentManager() { return fm; }
}
