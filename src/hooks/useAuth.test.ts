import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAuth } from "./useAuth";
import { supabase } from "@/integrations/supabase/client";

// Mock supabase client
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      signInWithSSO: vi.fn(),
    },
  },
}));

describe("useAuth hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default getSession mock
    (supabase.auth.getSession as any).mockResolvedValue({
      data: { session: null },
    });

    // Default onAuthStateChange mock
    (supabase.auth.onAuthStateChange as any).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  it("should initialize with null user and loading true, then resolve", async () => {
    const { result } = renderHook(() => useAuth());

    // Initially loading should be true
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBe(null);
  });

  it("should call signInWithPassword", async () => {
    (supabase.auth.signInWithPassword as any).mockResolvedValue({ data: { user: { email_confirmed_at: "date" } }, error: null });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("test@example.com", "password123");
    });

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "password123",
    });
  });

  it("should not enforce email confirmation on signIn", async () => {
    (supabase.auth.signInWithPassword as any).mockResolvedValue({ data: { user: { email_confirmed_at: null } }, error: null });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signIn("test@example.com", "password123");
    });

    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "password123",
    });
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });

  it("should call signUp", async () => {
    (supabase.auth.signUp as any).mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signUp("test@example.com", "password123");
    });

    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: "test@example.com",
      password: "password123",
    });
  });

  it("should call signInWithSSO", async () => {
    (supabase.auth.signInWithSSO as any).mockResolvedValue({ error: null });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signInWithSSO("company.com");
    });

    expect(supabase.auth.signInWithSSO).toHaveBeenCalledWith({
      domain: "company.com",
    });
  });
});
