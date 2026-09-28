package androidx.recyclerview.widget;
import android.content.Context; import android.view.*;
public class RecyclerView extends ViewGroup {
  public static final int SCROLL_STATE_IDLE = 0, SCROLL_STATE_DRAGGING = 1, SCROLL_STATE_SETTLING = 2, NO_POSITION = -1;
  public RecyclerView(Context c) { super(c); }
  protected void onLayout(boolean c, int l, int t, int r, int b) {}
  public LayoutManager getLayoutManager() { return null; } public void setLayoutManager(LayoutManager m) {}
  public Adapter getAdapter() { return null; } public void setAdapter(Adapter a) {}
  public ItemAnimator getItemAnimator() { return null; } public void setItemAnimator(ItemAnimator a) {}
  public void addOnScrollListener(OnScrollListener l) {} public void removeOnScrollListener(OnScrollListener l) {}
  public int getScrollState() { return 0; } public void stopScroll() {}
  public void scrollToPosition(int p) {} public void smoothScrollToPosition(int p) {} public void smoothScrollBy(int dx, int dy) {}
  public int computeVerticalScrollOffset() { return 0; } public int computeVerticalScrollRange() { return 0; } public int computeVerticalScrollExtent() { return 0; }
  public ViewHolder findViewHolderForAdapterPosition(int p) { return null; } public ViewHolder getChildViewHolder(View v) { return null; }
  public int getChildAdapterPosition(View v) { return 0; } public void setHasFixedSize(boolean b) {} public boolean isComputingLayout() { return false; } public boolean isAnimating() { return false; }
  public void addItemDecoration(ItemDecoration d) {}
  public abstract static class ItemDecoration {}
  public abstract static class ItemAnimator {}
  public abstract static class OnScrollListener { public void onScrolled(RecyclerView rv, int dx, int dy) {} public void onScrollStateChanged(RecyclerView rv, int s) {} }
  public abstract static class LayoutManager { public View findViewByPosition(int p) { return null; } public int getDecoratedTop(View v) { return 0; } public int getDecoratedBottom(View v) { return 0; } public int getChildCount() { return 0; } public View getChildAt(int i) { return null; } public int getPosition(View v) { return 0; } public void scrollToPosition(int p) {} public int getItemCount() { return 0; } }
  public static class LayoutParams extends ViewGroup.MarginLayoutParams { public LayoutParams(int w, int h) { super(w, h); } }
  public abstract static class ViewHolder { public final View itemView; public ViewHolder(View v) { itemView = v; } public final int getBindingAdapterPosition() { return 0; } public final int getAbsoluteAdapterPosition() { return 0; } public final int getAdapterPosition() { return 0; } public final int getLayoutPosition() { return 0; } public final int getItemViewType() { return 0; } }
  public abstract static class Adapter<VH extends ViewHolder> {
    public abstract VH onCreateViewHolder(ViewGroup p, int t); public abstract void onBindViewHolder(VH h, int p); public abstract int getItemCount();
    public void onBindViewHolder(VH h, int p, java.util.List<Object> payloads) {}
    public void onViewRecycled(VH h) {} public void onViewAttachedToWindow(VH h) {} public void onViewDetachedFromWindow(VH h) {}
    public int getItemViewType(int p) { return 0; } public long getItemId(int p) { return 0; } public void setHasStableIds(boolean b) {}
    public final void notifyDataSetChanged() {} public final void notifyItemChanged(int p) {} public final void notifyItemChanged(int p, Object payload) {}
    public final void notifyItemInserted(int p) {} public final void notifyItemRemoved(int p) {} public final void notifyItemRangeInserted(int p, int c) {} public final void notifyItemRangeRemoved(int p, int c) {} public final void notifyItemRangeChanged(int p, int c) {} public final void notifyItemMoved(int a, int b) {}
  }
}
