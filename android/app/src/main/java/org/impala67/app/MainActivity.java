package org.impala67.app;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import org.json.JSONException;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }

        // Edge-to-Edge: Status- und Navigationsleiste transparent
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
            getWindow().setNavigationBarContrastEnforced(false);
        }

        applySystemBars();

        NativeDiagnostics.collectExitReasons(this);
        if (savedInstanceState != null) NativeDiagnostics.note(this, "native-activity-recreated", null);

        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public void onPageLoaded(WebView view) {
                NativeDiagnostics.deliver(MainActivity.this, view);
            }

            // Stirbt der WebView-Prozess (z. B. Speicher voll auf 4-GB-Tablets), beendet Android sonst die
            // ganze App. Stattdessen den toten WebView verwerfen und die Activity neu aufbauen: Die App lädt
            // neu, die Daten liegen ohnehin in IndexedDB.
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                JSONObject data = new JSONObject();
                try {
                    data.put("name", detail.didCrash() ? "crashed" : "killed");
                    data.put("rendererPriority", detail.rendererPriorityAtExit());
                } catch (JSONException ignored) {
                }
                NativeDiagnostics.note(MainActivity.this, "native-renderer-gone", data);
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) parent.removeView(view);
                view.destroy();
                recreate();
                return true;
            }
        });
    }

    @Override
    public void onDestroy() {
        // Systemänderung, die nicht in android:configChanges steht: Android baut die Activity (und damit die App) neu auf
        if (isChangingConfigurations()) {
            JSONObject data = new JSONObject();
            try {
                data.put("name", "0x" + Integer.toHexString(getChangingConfigurations()));
            } catch (JSONException ignored) {
            }
            NativeDiagnostics.note(this, "native-config-change", data);
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applySystemBars();
        }
    }

    private void applySystemBars() {
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.show(WindowInsetsCompat.Type.systemBars());

        int nightMode = getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
        boolean isNight = nightMode == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        // In dunkler Ansicht helle Icons, in heller Ansicht dunkle Icons
        controller.setAppearanceLightStatusBars(!isNight);
    }
}
