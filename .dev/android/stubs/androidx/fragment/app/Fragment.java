package androidx.fragment.app;
import android.os.Bundle; import android.view.*; import android.content.*; import androidx.activity.result.*; import androidx.activity.result.contract.*;
public class Fragment implements androidx.lifecycle.LifecycleOwner {
  public androidx.lifecycle.Lifecycle getLifecycle() { return null; }
  public void setArguments(Bundle b) {} public Bundle getArguments() { return null; }
  public final Bundle requireArguments() { return null; }
  public final Context requireContext() { return null; } public Context getContext() { return null; }
  public final FragmentActivity requireActivity() { return null; } public final FragmentActivity getActivity() { return null; }
  public final FragmentManager getParentFragmentManager() { return null; }
  public final FragmentManager getChildFragmentManager() { return null; }
  public final boolean isAdded() { return false; }
  public View getView() { return null; } public final android.content.res.Resources getResources() { return null; } public void startActivity(android.content.Intent i) {} public final boolean isResumed() { return false; } public final boolean isDetached() { return false; } public final boolean isRemoving() { return false; } public androidx.lifecycle.LifecycleOwner getViewLifecycleOwner() { return null; }
  public void onCreate(Bundle b) {}
  public View onCreateView(LayoutInflater i, ViewGroup c, Bundle b) { return null; }
  public void onViewCreated(View v, Bundle b) {}
  public void onStart() {} public void onResume() {} public void onPause() {} public void onStop() {} public void onDestroyView() {} public void onDestroy() {}
  public void onSaveInstanceState(Bundle b) {}
  public final <I,O> ActivityResultLauncher<I> registerForActivityResult(ActivityResultContract<I,O> c, ActivityResultCallback<O> cb) { return null; }
}
