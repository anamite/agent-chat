/**
 * HtmlBlock.tsx — sandboxed HTML rendering via react-native-webview.
 *
 * Security model (§3 of BUILD_PLAN.md):
 *   - javaScriptEnabled={false} by default. The agent must explicitly set
 *     `allowJs: true` in the block to enable JS.
 *   - originWhitelist={[]} — the WebView cannot navigate anywhere; all
 *     external link clicks are suppressed.
 *   - No file access, no universal access, no storage.
 *   - A strict CSP <meta> is injected before the agent's HTML so inline
 *     scripts can't reach app internals even if JS is enabled.
 *   - Fixed height (block.height ?? 300), no scroll past container.
 *
 * The block is displayed inside a rounded dark card matching the design tokens.
 * "JS OFF" badge is shown by default; "JS ON" badge appears when allowJs is set.
 */

import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { HtmlBlock as HtmlBlockT } from "../../protocol/protocol";
import { colors, font, fontSize, radius, space, weight } from "../../theme/tokens";

const DEFAULT_HEIGHT = 300;

/**
 * Inject a strict CSP and dark-theme base styles before the agent's HTML so
 * it blends into the app and can't load external resources.
 */
function wrapHtml(raw: string, allowJs: boolean): string {
  const scriptSrc = allowJs ? "'unsafe-inline'" : "'none'";
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src ${scriptSrc}`;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{
    background:${colors.surface};color:${colors.text};
    font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    padding:12px;overflow-x:hidden;
  }
  a{color:${colors.accent};text-decoration:none}
  img{max-width:100%;height:auto;border-radius:8px}
  pre,code{background:${colors.canvas};border-radius:4px;padding:2px 6px;font-size:13px}
</style>
</head>
<body>${raw}</body>
</html>`;
}

export default function HtmlBlock({ block }: { block: HtmlBlockT }) {
  const allowJs = block.allowJs === true;
  const height = block.height ?? DEFAULT_HEIGHT;
  const html = wrapHtml(block.html, allowJs);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.dots}>
          <View style={[styles.dot, { backgroundColor: colors.fail }]} />
          <View style={[styles.dot, { backgroundColor: colors.warn }]} />
          <View style={[styles.dot, { backgroundColor: colors.ok }]} />
        </View>
        <Text style={styles.label}>RENDERED HTML</Text>
        <Text style={allowJs ? styles.jsOn : styles.jsOff}>
          {allowJs ? "JS ON" : "JS OFF"}
        </Text>
      </View>
      <View style={[styles.frame, { height }]}>
        <WebView
          source={{ html }}
          style={styles.webview}
          // Security constraints
          javaScriptEnabled={allowJs}
          originWhitelist={[]}
          allowFileAccess={false}
          allowUniversalAccessFromFileURLs={false}
          allowFileAccessFromFileURLs={false}
          domStorageEnabled={false}
          geolocationEnabled={false}
          mediaPlaybackRequiresUserAction
          // Suppress external navigation — all clicks stay sandboxed.
          onShouldStartLoadWithRequest={(req) =>
            req.url === "about:blank" || req.url.startsWith("data:")
          }
          scrollEnabled
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          scalesPageToFit={false}
          backgroundColor={colors.surface}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.widget,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  dots: { flexDirection: "row", gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 999, opacity: 0.85 },
  label: {
    flex: 1,
    color: colors.accent,
    fontFamily: font.mono,
    fontSize: 10,
    fontWeight: weight.semibold,
    letterSpacing: 0.5,
  },
  jsOff: {
    color: colors.text3,
    fontSize: fontSize.xs,
    fontWeight: weight.semibold,
  },
  jsOn: {
    color: colors.warn,
    fontSize: fontSize.xs,
    fontWeight: weight.semibold,
    letterSpacing: 0.5,
  },
  frame: {
    overflow: "hidden",
  },
  webview: {
    flex: 1,
    backgroundColor: colors.surface,
  },
});
