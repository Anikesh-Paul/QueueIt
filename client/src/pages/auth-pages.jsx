import { Link } from "react-router-dom";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthForm } from "@/components/auth/auth-form";
import { MotifIllustration } from "@/components/brand/motif-illustration";
import { useI18n } from "@/context/i18n-context";
import { LanguageToggle } from "@/components/shell/language-toggle";

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
  const { t } = useI18n();
  return (
    <div
      className="mx-auto w-full max-w-lg px-4 py-16 text-center"
      data-testid="not-found"
    >
      <div className="mb-6 flex justify-center">
        <LanguageToggle />
      </div>
      <MotifIllustration
        motif="serviceWindow"
        variant="error"
        dimmer
        className="mb-5"
      />
      <p className="font-display text-display font-semibold tracking-[-0.01em] text-foreground">
        {t("notFound.title")}
      </p>
      <p className="mt-1 text-sm text-text-secondary">{t("notFound.body")}</p>
      <Link
        to="/queues"
        className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        {t("notFound.back")}
      </Link>
    </div>
  );
}