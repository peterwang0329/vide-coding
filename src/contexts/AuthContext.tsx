/**
 * 認證 Context
 * 全域管理使用者登入狀態、Token 驗證、登入/註冊/登出操作
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { apiFetch, setToken, removeToken, getToken } from "../utils/apiClient";

/** 使用者資訊介面 */
export interface UserInfo {
  id: number;
  username: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
}

/** AuthContext 提供的值 */
interface AuthContextValue {
  /** 當前使用者資訊（null 表示未登入） */
  user: UserInfo | null;
  /** 是否已登入 */
  isAuthenticated: boolean;
  /** 是否正在載入（初始驗證 Token） */
  isLoading: boolean;
  /** 登入 */
  login: (username: string, password: string) => Promise<void>;
  /** 註冊 */
  register: (username: string, password: string, displayName?: string) => Promise<void>;
  /** 登出 */
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** 取得 AuthContext 的值 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth 必須在 AuthProvider 內部使用");
  }
  return ctx;
}

/** AuthProvider 元件 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 啟動時驗證現有 Token
  useEffect(() => {
    const verifyToken = async () => {
      const token = getToken();
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const userData = await apiFetch<UserInfo>("/api/auth/me");
        setUser(userData);
      } catch (err: any) {
        // 避免在網路不穩或伺服器錯誤 (5xx) 時誤刪 Token
        // apiClient 在 401 時已會自動清除 Token
        if (err.status === 401 || !getToken()) {
          removeToken();
          setUser(null);
        } else {
          console.error("驗證 Token 失敗 (網路或伺服器錯誤):", err);
          setUser(null); // 無法取得使用者資料，暫時視為未登入，但不清除 Token
        }
      } finally {
        setIsLoading(false);
      }
    };

    verifyToken();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const tokenData = await apiFetch<{ access_token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    setToken(tokenData.access_token);

    // 取得使用者資訊
    const userData = await apiFetch<UserInfo>("/api/auth/me");
    setUser(userData);
  }, []);

  const register = useCallback(async (username: string, password: string, displayName?: string) => {
    // 註冊
    await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
        display_name: displayName || username,
      }),
    });

    // 註冊成功後自動登入
    await login(username, password);
  }, [login]);

  const logout = useCallback(() => {
    removeToken();
    setUser(null);
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    register,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
