import * as SecureStore from 'expo-secure-store';

const KEY = 'conexion';

export async function loadConnection() {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const saveConnection = (conn) => SecureStore.setItemAsync(KEY, JSON.stringify(conn));
export const clearConnection = () => SecureStore.deleteItemAsync(KEY);
