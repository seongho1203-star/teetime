package androidx.recyclerview.widget;
public class LinearLayoutManager extends RecyclerView.LayoutManager {
  public static final int VERTICAL = 1, HORIZONTAL = 0;
  public LinearLayoutManager(android.content.Context c) {} public LinearLayoutManager(android.content.Context c, int o, boolean r) {}
  public boolean getStackFromEnd() { return false; } public void setStackFromEnd(boolean b) {} public boolean getReverseLayout() { return false; } public void setReverseLayout(boolean b) {}
  public int findFirstVisibleItemPosition() { return 0; } public int findLastVisibleItemPosition() { return 0; } public int findFirstCompletelyVisibleItemPosition() { return 0; } public int findLastCompletelyVisibleItemPosition() { return 0; }
  public void scrollToPositionWithOffset(int p, int o) {} public int getOrientation() { return 1; } public void setOrientation(int o) {}
}
