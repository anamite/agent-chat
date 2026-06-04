# Fix UI Issues in Hermes Mobile App

## Issue 1: Duplicate Tab Headings
In every tab (Brain, Processes, Settings), the tab name/heading appears **twice**:
- Once in the default top navigation bar (left-aligned)
- Once repeated below it on the main screen

These are redundant. The bottom tab bar already shows the active tab with its icon and label — and the screen content itself should not repeat the tab name as a heading unless it serves a real purpose. Choose ONE approach:

- **Option A**: Remove the screen-level heading entirely and let the content fill the space (cleanest — bottom tabs + icon already identify the screen)
- **Option B**: If the top nav bar header is from React Navigation's `headerTitle`, set it to an empty string or hide the header, and keep only the screen-level heading

Go with Option A wherever possible — bottom tab labels already tell the user where they are.

## Issue 2: Text Input Hidden Behind Keyboard (Brain Tab)
In the Brain/chat tab, when the user taps the text input at the bottom, the keyboard opens but the input stays behind it — the user can't see what they're typing. The view does not push up with the keyboard.

Fix this by:
- Using `KeyboardAvoidingView` with `behavior="padding"` on Android (since `height` and `position` behave differently on Android vs iOS)
- Or wrapping the chat screen in a proper keyboard-aware layout that shifts content up
- Ensure the `TextInput` at the bottom remains visible above the keyboard
- Test that this doesn't break the message list scroll behavior

## Constraints
- Project: /home/hermes/hermes-mobile-gateway
- Expo SDK 54, React Native
- Focus on the app/src/ directory — likely the screen components and the tab navigator layout
- Do NOT change any database or protocol code
- Do NOT change package versions
- Make minimal, targeted edits
