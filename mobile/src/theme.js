import { useColorScheme } from 'react-native';

const light = { bg: '#f5f6f8', card: '#ffffff', text: '#1c1f24', muted: '#6b7280', border: '#e5e7eb', accent: '#2563eb', soon: '#b45309', overdue: '#b91c1c', onAccent: '#ffffff' };
const dark = { bg: '#111317', card: '#1a1d23', text: '#e8eaed', muted: '#9aa0a6', border: '#2b2f36', accent: '#6ea8fe', soon: '#f59e0b', overdue: '#f87171', onAccent: '#0b1220' };

export const useTheme = () => (useColorScheme() === 'dark' ? dark : light);
