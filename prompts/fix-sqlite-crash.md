# Fix: NativeDatabase.prepareAsync NullPointerException on Android

## Error
```
Uncaught (in promise, id: 0) Error: Call to function 'NativeDatabase.prepareAsync' has been rejected.
→ Caused by: java.lang.NullPointerException: java.lang.NullPointerException
```

Stack trace points to `construct.js (4:65)` in the Expo bundle, which is the native module bridge code.

## Context
- Project: Expo app (SDK 54) running on Android via Expo Go
- The error happens when `expo-sqlite` tries to call `NativeDatabase.prepareAsync`
- This is a native module rejection — the Java side is throwing NPE before responding to JS

## What to investigate

1. **Check expo-sqlite usage**: Search all files for `openDatabaseAsync`, `prepareAsync`, `execAsync`, `getFirstAsync`, `getAllAsync`, `runAsync` calls from expo-sqlite. Look for:
   - Database opened with a null/undefined path
   - Database opened before the module is ready (missing await on `openDatabaseAsync`)
   - Using the database after it's been closed

2. **Check expo-sqlite version**: Is it compatible with Expo SDK 54 / expo-go? The app uses SDK 54 (package.json in `app/`). Verify expo-sqlite version compatibility.

3. **Check if there's a DB initialization race**: The `prepareAsync` call might be happening before the database file is fully initialized, or on a null reference after a failed `openDatabaseAsync`.

4. **Check migration/init code**: Look for any schema initialization that might be calling `prepareAsync` without proper error handling or with invalid SQL.

## Requirements
- Fix the root cause (likely a race condition or missing null check)
- Add proper error handling around database operations
- Verify the fix doesn't break on iOS (if applicable)
- Run `cd /home/hermes/hermes-mobile-gateway/app && npx expo-doctor` to check for any expo config issues
- Do NOT upgrade expo-sqlite or any other packages unless they are clearly the cause
