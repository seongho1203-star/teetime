package androidx.fragment.app;
public class FragmentTransaction {
  public FragmentTransaction add(Fragment f, String tag) { return this; }
  public FragmentTransaction remove(Fragment f) { return this; }
  public int commit() { return 0; } public int commitAllowingStateLoss() { return 0; } public void commitNow() {} public void commitNowAllowingStateLoss() {}
}
