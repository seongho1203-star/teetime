package androidx.recyclerview.widget;
import android.content.Context; import android.view.*; import java.util.*;
/*
 * 스텁 — 검사 틀(`.dev/android`)에서만 쓴다. 진짜 RecyclerView는 구글 저장소에만 있어
 * 여기서 못 받는다. 화면을 PNG로 찍을 수 있게 **줄을 전부 세로로 쌓아 그리는** 아주 단순한 판이다
 * (`stackFromEnd`면 아래에 붙인다). 스크롤·재활용은 흉내 내지 않는다.
 */
public class RecyclerView extends ViewGroup {
  public static final int SCROLL_STATE_IDLE = 0, SCROLL_STATE_DRAGGING = 1, SCROLL_STATE_SETTLING = 2, NO_POSITION = -1;
  private Adapter adapter; private LayoutManager lm; private ItemAnimator anim;
  private final List<ViewHolder> holders = new ArrayList<>();
  public RecyclerView(Context c) { super(c); }
  public LayoutManager getLayoutManager() { return lm; } public void setLayoutManager(LayoutManager m) { lm = m; if (m != null) m.rv = this; }
  public Adapter getAdapter() { return adapter; } public void setAdapter(Adapter a) { adapter = a; if (a != null) a.owner = this; requestLayout(); }
  public ItemAnimator getItemAnimator() { return anim; } public void setItemAnimator(ItemAnimator a) { anim = a; }
  public void addOnScrollListener(OnScrollListener l) {} public void removeOnScrollListener(OnScrollListener l) {}
  public int getScrollState() { return 0; } public void stopScroll() {}
  public void scrollToPosition(int p) {} public void smoothScrollToPosition(int p) {} public void smoothScrollBy(int dx, int dy) {}
  public int computeVerticalScrollOffset() { return 0; } public int computeVerticalScrollRange() { return 0; } public int computeVerticalScrollExtent() { return 0; }
  public ViewHolder findViewHolderForAdapterPosition(int p) { return p >= 0 && p < holders.size() ? holders.get(p) : null; }
  public ViewHolder getChildViewHolder(View v) { for (ViewHolder h : holders) if (h.itemView == v) return h; return null; }
  public int getChildAdapterPosition(View v) { ViewHolder h = getChildViewHolder(v); return h == null ? -1 : h.pos; }
  public void setHasFixedSize(boolean b) {} public boolean isComputingLayout() { return false; } public boolean isAnimating() { return false; }
  public void addItemDecoration(ItemDecoration d) {}
  @SuppressWarnings("unchecked")
  private void rebuild() {
    removeAllViews(); holders.clear();
    if (adapter == null) return;
    for (int i = 0; i < adapter.getItemCount(); i++) {
      ViewHolder h = adapter.onCreateViewHolder(this, adapter.getItemViewType(i));
      h.pos = i; adapter.onBindViewHolder(h, i); holders.add(h);
      addView(h.itemView);
    }
  }
  @Override protected void onMeasure(int w, int h) {
    rebuild();
    int width = MeasureSpec.getSize(w);
    for (int i = 0; i < getChildCount(); i++) getChildAt(i).measure(MeasureSpec.makeMeasureSpec(width - getPaddingLeft() - getPaddingRight(), MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
    setMeasuredDimension(width, MeasureSpec.getSize(h));
  }
  @Override protected void onLayout(boolean c, int l, int t, int r, int b) {
    int total = 0; for (int i = 0; i < getChildCount(); i++) total += getChildAt(i).getMeasuredHeight();
    int y = (b - t) - getPaddingBottom() - total;
    if (y > getPaddingTop() && !(lm instanceof LinearLayoutManager && ((LinearLayoutManager) lm).getStackFromEnd())) y = getPaddingTop();
    for (int i = 0; i < getChildCount(); i++) { View v = getChildAt(i); v.layout(getPaddingLeft(), y, getPaddingLeft() + v.getMeasuredWidth(), y + v.getMeasuredHeight()); y += v.getMeasuredHeight(); }
  }
  public abstract static class ItemDecoration {}
  public abstract static class ItemAnimator {}
  public abstract static class OnScrollListener { public void onScrolled(RecyclerView rv, int dx, int dy) {} public void onScrollStateChanged(RecyclerView rv, int s) {} }
  public abstract static class LayoutManager { RecyclerView rv; public View findViewByPosition(int p) { ViewHolder h = rv == null ? null : rv.findViewHolderForAdapterPosition(p); return h == null ? null : h.itemView; } public int getDecoratedTop(View v) { return v.getTop(); } public int getDecoratedBottom(View v) { return v.getBottom(); } public int getChildCount() { return rv == null ? 0 : rv.getChildCount(); } public View getChildAt(int i) { return rv.getChildAt(i); } public int getPosition(View v) { return rv.getChildAdapterPosition(v); } public void scrollToPosition(int p) {} public int getItemCount() { return rv == null || rv.adapter == null ? 0 : rv.adapter.getItemCount(); } }
  public static class LayoutParams extends ViewGroup.MarginLayoutParams { public LayoutParams(int w, int h) { super(w, h); } }
  public abstract static class ViewHolder { public final View itemView; int pos; public ViewHolder(View v) { itemView = v; } public final int getBindingAdapterPosition() { return pos; } public final int getAbsoluteAdapterPosition() { return pos; } public final int getAdapterPosition() { return pos; } public final int getLayoutPosition() { return pos; } public final int getItemViewType() { return 0; } }
  public abstract static class Adapter<VH extends ViewHolder> {
    RecyclerView owner;
    public abstract VH onCreateViewHolder(ViewGroup p, int t); public abstract void onBindViewHolder(VH h, int p); public abstract int getItemCount();
    public void onBindViewHolder(VH h, int p, java.util.List<Object> payloads) { onBindViewHolder(h, p); }
    public void onViewRecycled(VH h) {} public void onViewAttachedToWindow(VH h) {} public void onViewDetachedFromWindow(VH h) {}
    public int getItemViewType(int p) { return 0; } public long getItemId(int p) { return 0; } public void setHasStableIds(boolean b) {}
    private void changed() { if (owner != null) owner.requestLayout(); }
    public final void notifyDataSetChanged() { changed(); } public final void notifyItemChanged(int p) { changed(); } public final void notifyItemChanged(int p, Object payload) { changed(); }
    public final void notifyItemInserted(int p) { changed(); } public final void notifyItemRemoved(int p) { changed(); } public final void notifyItemRangeInserted(int p, int c) { changed(); } public final void notifyItemRangeRemoved(int p, int c) { changed(); } public final void notifyItemRangeChanged(int p, int c) { changed(); } public final void notifyItemMoved(int a, int b) { changed(); }
  }
}
