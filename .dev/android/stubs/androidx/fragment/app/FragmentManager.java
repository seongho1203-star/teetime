package androidx.fragment.app;
public abstract class FragmentManager {
  public FragmentTransaction beginTransaction() { return null; }
  public Fragment findFragmentByTag(String t) { return null; }
  public void setFragmentResult(String k, android.os.Bundle b) {}
  public void setFragmentResultListener(String k, androidx.lifecycle.LifecycleOwner o, FragmentResultListener l) {}
  public void clearFragmentResultListener(String k) {}
  public boolean isStateSaved() { return false; }
  public boolean isDestroyed() { return false; }
  public boolean executePendingTransactions() { return true; }
}
