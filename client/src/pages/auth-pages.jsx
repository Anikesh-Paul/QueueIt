import { Link } from "react-router-dom";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthForm } from "@/components/auth/auth-form";
import { MotifIllustration } from "@/components/brand/motif-illustration";

export function LoginPage() {
  return (
    <AuthLayout>
      <AuthForm mode="login" />
    </AuthLayout>
  );
}

export function RegisterPage() {
  return (
    <AuthLayout>
      <AuthForm mode="register" />
    </AuthLayout>
  );
}

/** Full-page soft recover — reuses quiet service window motif (dimmer). */
export function NotFoundPage() {
  return (
    <div
      className="mx-auto w-full max-w-lg px-4 py-16 text-center"
      data-testid="not-found"
    >
      <MotifIllustration
        motif="serviceWindow"
        variant="error"
        dimmer
        className="mb-5"
      />
      <p className="font-display text-display font-semibold tracking-[-0.01em] text-foreground">
        Page not found
      </p>
      <p className="mt-1 text-sm text-text-secondary">Not a QueueIt page.</p>
      <Link
        to="/queues"
        className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to queues
      </Link>
    </div>
  );
}