# Fix duplicate headings in all three tab screens + keyboard issue

The `_layout.tsx` already has `headerShown: false`, but all three screens still render their own `<Text style={styles.title}>X</Text>` heading. These are redundant with the bottom tab bar labels and waste vertical space.

## Exact changes needed

### 1. `/home/hermes/hermes-mobile-gateway/app/app/(tabs)/brain.tsx`

The header currently (lines 275-278):
```tsx
<View style={styles.header}>
  <Text style={styles.title}>Brain</Text>
  <StatusPill />
</View>
```

Change to — keep the StatusPill but remove the "Brain" text:
```tsx
<View style={styles.header}>
  <StatusPill />
</View>
```

Also remove the `keyboardVerticalOffset={8}` prop from KeyboardAvoidingView (line 286) — on Android with `behavior="padding"`, an offset can push content too far. Let the OS handle it.

### 2. `/home/hermes/hermes-mobile-gateway/app/app/(tabs)/processes.tsx`

Remove the entire header block (lines 12-14):
```tsx
<View style={styles.header}>
  <Text style={styles.title}>Processes</Text>
</View>
```

### 3. `/home/hermes/hermes-mobile-gateway/app/app/(tabs)/settings.tsx`

Remove the entire header block (lines 55-57):
```tsx
<View style={styles.header}>
  <Text style={styles.title}>Settings</Text>
</View>
```

## Rules
- Do NOT touch any other code
- Make only these targeted edits
- Do NOT add new imports or change styles
- Do NOT change package versions
