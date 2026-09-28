package androidx.recyclerview.widget;
public class ItemTouchHelper extends RecyclerView.ItemDecoration {
  public static final int LEFT = 4, RIGHT = 8, UP = 1, DOWN = 2, START = 16, END = 32, ACTION_STATE_SWIPE = 1, ACTION_STATE_IDLE = 0;
  public ItemTouchHelper(Callback c) {} public void attachToRecyclerView(RecyclerView rv) {}
  public abstract static class Callback {
    public abstract int getMovementFlags(RecyclerView rv, RecyclerView.ViewHolder h);
    public abstract boolean onMove(RecyclerView rv, RecyclerView.ViewHolder a, RecyclerView.ViewHolder b);
    public abstract void onSwiped(RecyclerView.ViewHolder h, int dir);
    public float getSwipeThreshold(RecyclerView.ViewHolder h) { return .5f; } public float getSwipeEscapeVelocity(float d) { return d; }
    public void clearView(RecyclerView rv, RecyclerView.ViewHolder h) {}
    public void onChildDraw(android.graphics.Canvas c, RecyclerView rv, RecyclerView.ViewHolder h, float dx, float dy, int state, boolean active) {}
    public void onSelectedChanged(RecyclerView.ViewHolder h, int state) {}
    public boolean isItemViewSwipeEnabled() { return true; } public boolean isLongPressDragEnabled() { return false; }
  }
  public abstract static class SimpleCallback extends Callback {
    public SimpleCallback(int drag, int swipe) {}
    public int getSwipeDirs(RecyclerView rv, RecyclerView.ViewHolder h) { return 0; } public int getDragDirs(RecyclerView rv, RecyclerView.ViewHolder h) { return 0; }
    public int getMovementFlags(RecyclerView rv, RecyclerView.ViewHolder h) { return 0; }
  }
}
