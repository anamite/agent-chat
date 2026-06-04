/**
 * BlockErrorBoundary.tsx — isolates a single SDUI block's render.
 *
 * The agent drives the UI; a malformed or buggy block must never take down the
 * whole chat (no white screen, §M5). Each block is wrapped so a throw during
 * render collapses to a small inline fallback instead of unmounting the list.
 */

import { Component, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fontSize, radius, space, weight } from "../theme/tokens";

interface Props {
  /** Block type, for the fallback label. */
  type: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

export default class BlockErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn(`[sdui] block "${this.props.type}" failed to render`, error);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.label}>⚠ couldn't display this {this.props.type}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  fallback: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.console,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.fail,
    borderWidth: 1,
  },
  label: {
    color: colors.fail,
    fontSize: fontSize.sm,
    fontWeight: weight.medium,
  },
});
