import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, AlertCircle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import CloudPilotLogo from "@/components/CloudPilotLogo";
import { useAuth } from "@/hooks/useAuth";

const Auth = () => {
  const [mode, setMode] = useState<"signin" | "signup" | "sso">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const { user, signIn, signUp, signInWithSSO } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/app", { replace: true });
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");

    if (mode === "sso") {
      if (!email.trim()) {
        setError("Company email is required for SSO.");
        return;
      }
    } else {
      if (!email.trim() || !password.trim()) {
        setError("Email and password are required.");
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
        navigate("/app", { replace: true });
      } else if (mode === "signup") {
        await signUp(email.trim(), password);
        setMode("signin");
      } else if (mode === "sso") {
        const domain = email.trim().split("@")[1];
        if (!domain) {
          throw new Error("Invalid email domain for SSO.");
        }
        await signInWithSSO(domain);
        // Supabase will redirect the user to the IdP
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(err.message ?? "An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">

        {/* Logo & branding */}
        <div className="text-center space-y-4">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/25 flex items-center justify-center mx-auto glow-primary">
            <CloudPilotLogo className="w-12 h-12 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">CloudPilot AI</h1>
            <p className="text-sm text-muted-foreground mt-1">AWS Cloud Security Intelligence</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-xl p-8 space-y-6">

          {/* Mode tabs */}
          <div className="flex rounded-lg bg-muted p-1 gap-1">
            <button
              type="button"
              onClick={() => { setMode("signin"); setError(""); setSuccessMsg(""); }}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                mode === "signin"
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode("sso"); setError(""); setSuccessMsg(""); }}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                mode === "sso"
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              SSO Login
            </button>
            <button
              type="button"
              onClick={() => { setMode("signup"); setError(""); setSuccessMsg(""); }}
              className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all ${
                mode === "signup"
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {mode === "sso" ? "Company Email" : "Email"}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                className="w-full rounded-lg bg-muted border border-border px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/15"
              />
            </div>

            {/* Password */}
            {mode !== "sso" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "Min. 6 characters" : "Enter your password"}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    className="w-full rounded-lg bg-muted border border-border px-3.5 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/15"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Success */}
            {successMsg && (
              <div className="flex items-start gap-2 text-primary text-xs bg-primary/10 border border-primary/20 rounded-lg px-3 py-2.5">
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : mode === "signin" ? (
                "Sign In"
              ) : mode === "sso" ? (
                "Sign in with SSO"
              ) : (
                "Create Account"
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          Your AWS credentials are never stored. They are transmitted per-request over TLS.
        </p>
      </div>
    </div>
  );
};

export default Auth;
