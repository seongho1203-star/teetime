package androidx.fragment.app;
/* 스텁 — 검사 틀에서만 쓴다. 화면을 찍을 때 NPE가 안 나게 아무 일도 안 하는 판을 준다. */
public class FragmentManager {
  public FragmentTransaction beginTransaction() { return new FragmentTransaction(); }
  public Fragment findFragmentByTag(String t) { return null; }
  public void setFragmentResult(String k, android.os.Bundle b) {}
  public void setFragmentResultListener(String k, androidx.lifecycle.LifecycleOwner o, FragmentResultListener l) {}
  public void clearFragmentResultListener(String k) {}
  public boolean isStateSaved() { return false; }
  public boolean isDestroyed() { return false; }
  public boolean executePendingTransactions() { return true; }
}
