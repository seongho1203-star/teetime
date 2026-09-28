package androidx.fragment.app;
public abstract class FragmentTransaction {
  public FragmentTransaction add(Fragment f, String tag) { return this; }
  public FragmentTransaction remove(Fragment f) { return this; }
  public abstract int commit(); public abstract int commitAllowingStateLoss(); public abstract void commitNow(); public abstract void commitNowAllowingStateLoss();
}
