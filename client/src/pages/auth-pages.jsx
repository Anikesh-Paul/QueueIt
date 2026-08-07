import { Link } from "react-router-dom";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthForm } from "@/components/auth/auth-form";

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

export function NotFoundPage() {
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-16 text-center">
      <p className="font-heading text-display text-foreground">Page not found</p>
      <p className="mt-1 text-sm text-text-secondary">
        That doesn&apos;t look like a QueueIt page.
      </p>
      <Link
        to="/queues"
        className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Back to queues
      </Link>
    </div>
  );
}