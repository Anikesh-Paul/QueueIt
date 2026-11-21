import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Clock, Download, Languages, Smartphone } from "lucide-react";
import { QueueItMark, Wordmark } from "@/components/brand/wordmark";
import { LanguageToggle } from "@/components/shell/language-toggle";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { SkipToContent } from "@/components/shell/skip-to-content";
import { useApp } from "@/context/app-context";
import { useI18n } from "@/context/i18n-context";
import { fetchStatusBoard } from "@/api";
import { MAIN_CONTENT_ID } from "@/lib/skip-to-content";
import { STATUS_BOARD_PATH } from "@/lib/status-board";
import { landingStripItems, tickValue } from "@/lib/landing";
import { cn } from "@/lib/utils";

const LIVE_POLL_MS = 30_000;
const LIVE_NOTE =
  "rounded-2xl border border-dashed border-border-strong px-5 py-8 text-center text-text-secondary";
const EYEBROW = "text-xs font-semibold tracking-[0.14em] uppercase";

/** Section heading at the landing's 2 → 2.5 rem Fraunces step (see DESIGN.md). */
function SectionTitle({ id, className, children }) {
  return (
    <h2
      id={id}
      className={cn(
        "font-display text-[2rem] leading-tight font-semibold tracking-[-0.02em] text-foreground sm:text-[2.5rem]",
        className
      )}
    >
      {children}
    </h2>
  );
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Sets `data-revealed` once the element scrolls into view (CSS does the motion). */
function useRevealed(ref, { once = true } = {}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          if (once) io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once]);
  return revealed;
}

function Reveal({ as: Tag = "div", delay = 0, className, children, ...rest }) {
  const ref = useRef(null);
  const revealed = useRevealed(ref);
  return (
    <Tag
      ref={ref}
      className={cn("landing-reveal", className)}
      data-revealed={revealed || undefined}
      style={{ "--reveal-delay": `${delay * 90}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Joining as a guest: same path as the login page's "Continue as guest". */
function useJoinAsGuest() {
  const { enterGuestMode, isGuest } = useApp();
  const navigate = useNavigate();
  return () => {
    if (!isGuest) enterGuestMode();
    navigate("/queues");
  };
}

const CTA_TONES = {
  default: {
    guest: "bg-primary text-primary-foreground shadow-lift hover:bg-primary-hover focus-visible:ring-ring/50",
    login: "border-border-strong bg-card text-foreground hover:bg-secondary focus-visible:ring-ring/50",
  },
  // On the forest band.
  inverse: {
    guest: "bg-[#f0fdf4] text-[#1b4332] hover:bg-white focus-visible:ring-[#b7e4c7]",
    login: "border-[#f0fdf4]/40 text-[#f0fdf4] hover:bg-white/10 focus-visible:ring-[#b7e4c7]",
  },
};

/** The two landing CTAs: join as a guest (primary) and log in. */
function CtaPair({ testIdPrefix, tone = "default", className }) {
  const { t } = useI18n();
  const joinAsGuest = useJoinAsGuest();
  const colors = CTA_TONES[tone];
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <button
        type="button"
        onClick={joinAsGuest}
        data-testid={`${testIdPrefix}-guest`}
        className={cn(
          "group inline-flex h-12 items-center gap-2 rounded-xl px-5 text-base font-semibold outline-none focus-visible:ring-3",
          colors.guest
        )}
      >
        {t("landing.ctaGuest")}
        <ArrowRight
          className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </button>
      <Link
        to="/login"
        data-testid={`${testIdPrefix}-login`}
        className={cn(
          "inline-flex h-12 items-center rounded-xl border px-5 text-base font-semibold outline-none focus-visible:ring-3",
          colors.login
        )}
      >
        {t("landing.ctaLogin")}
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ hero */

const PHONE_SEQUENCE = [4, 3, 2, 1, 0];

/** A phone showing a token counting down to "your turn". Decorative loop. */
function PhoneMock() {
  const { t } = useI18n();
  const [step, setStep] = useState(prefersReducedMotion() ? 2 : 0);
  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    const id = window.setInterval(() => setStep((s) => (s + 1) % PHONE_SEQUENCE.length), 1700);
    return () => window.clearInterval(id);
  }, []);
  const ahead = PHONE_SEQUENCE[step];
  const turn = ahead === 0;
  const progress = 1 - ahead / PHONE_SEQUENCE[0];
  const R = 34;
  const C = 2 * Math.PI * R;

  return (
    <div
      role="img"
      aria-label={t("landing.phoneLabel")}
      data-testid="landing-phone"
      className="landing-phone w-[11.5rem] rounded-[2rem] border border-[#133227] bg-[#133227] p-2 shadow-dialog sm:w-[15rem]"
    >
      <div aria-hidden="true" className="overflow-hidden rounded-[1.6rem] bg-card px-4 pt-3 pb-5">
        <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-border-strong" />
        <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-text-secondary uppercase">
          {t("landing.phoneQueue")}
        </p>
        <div className="relative mx-auto mt-3 grid size-[6.5rem] place-items-center">
          <svg viewBox="0 0 80 80" className="absolute inset-0 size-full -rotate-90">
            <circle cx="40" cy="40" r={R} fill="none" stroke="var(--secondary)" strokeWidth="6" />
            <circle
              cx="40"
              cy="40"
              r={R}
              fill="none"
              stroke={turn ? "var(--warning)" : "var(--primary)"}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={C * (1 - Math.max(0.06, progress))}
              className="landing-ring"
            />
          </svg>
          <div className="text-center">
            <p className="text-[0.625rem] font-semibold tracking-[0.08em] text-text-secondary uppercase">
              {t("landing.phoneToken")}
            </p>
            <p className="font-metric text-[1.75rem] leading-none font-bold tracking-[-0.02em] text-foreground tabular-nums">
              A27
            </p>
          </div>
        </div>
        <p
          key={step}
          className={cn(
            "landing-tick mt-4 min-h-[2.5rem] text-center text-sm leading-tight font-semibold",
            turn ? "text-warning-ink" : "text-foreground"
          )}
        >
          {turn ? t("landing.phoneTurn") : t("landing.phoneAhead", { n: ahead })}
        </p>
        <div className="mt-3 flex justify-center gap-1.5">
          {PHONE_SEQUENCE.slice(0, -1).map((n) => (
            <span
              key={n}
              className={cn(
                "h-1.5 w-6 rounded-full transition-colors duration-300",
                n > ahead ? "bg-primary" : "bg-secondary"
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Slow drifting ticket stubs behind the hero. */
function StubDrift() {
  return (
    <div aria-hidden="true" className="landing-stubs pointer-events-none absolute inset-x-0 bottom-6 overflow-hidden">
      <div className="landing-stub-track flex w-max gap-6">
        {Array.from({ length: 28 }, (_, i) => (
          <span
            key={i}
            className="landing-stub block h-12 w-9 shrink-0 rounded-md border border-primary/15 bg-card/60"
            style={{ transform: `translateY(${(i % 3) * 6}px)` }}
          />
        ))}
      </div>
    </div>
  );
}

function Hero() {
  const { t } = useI18n();
  const artRef = useRef(null);

  useEffect(() => {
    const el = artRef.current;
    if (!el || prefersReducedMotion()) return undefined;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = Math.min(window.scrollY, window.innerHeight);
        el.style.setProperty("--parallax", `${(y * 0.08).toFixed(1)}px`);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section
      aria-labelledby="landing-hero-title"
      className="relative overflow-hidden pb-24 sm:pb-28"
      data-testid="landing-hero"
    >
      <StubDrift />
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pt-8 sm:px-6 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-10 lg:pt-16">
        <div className="min-w-0">
          <p className={cn(EYEBROW, "landing-rise text-primary")} style={{ "--rise": 0 }}>
            {t("landing.eyebrow")}
          </p>
          <h1
            id="landing-hero-title"
            data-testid="landing-heading"
            className="landing-rise mt-4 max-w-[14ch] font-display text-[2.625rem] leading-[1.04] font-semibold tracking-[-0.03em] text-balance text-foreground sm:text-[3.5rem] lg:text-[4.25rem]"
            style={{ "--rise": 1 }}
          >
            {t("landing.heroTitle")}
          </h1>
          <p
            className="landing-rise mt-5 max-w-[34rem] text-[1.0625rem] leading-relaxed text-text-secondary sm:text-lg"
            style={{ "--rise": 2 }}
          >
            {t("landing.heroBody")}
          </p>
          <div className="landing-rise mt-8" style={{ "--rise": 3 }}>
            <CtaPair testIdPrefix="landing-cta" />
            <Link
              to={STATUS_BOARD_PATH}
              data-testid="landing-cta-board"
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
            >
              {t("landing.ctaBoard")}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div ref={artRef} className="landing-art relative min-w-0 pb-10 lg:pb-0">
          <div className="landing-art-frame overflow-hidden rounded-[1.5rem] border border-border shadow-dialog">
            <img
                src="/landing/hero.webp"
                srcSet="/landing/hero-800.webp 800w, /landing/hero.webp 1600w"
                sizes="(min-width: 1024px) 600px, 100vw"
                width="1600"
                height="900"
                alt={t("landing.heroImageAlt")}
                fetchPriority="high"
                className="landing-art-img block aspect-[4/3] h-auto w-full object-cover sm:aspect-[16/10] lg:aspect-[4/4.2]"
              />
          </div>
          <div className="absolute -bottom-2 right-3 sm:right-auto sm:left-1/2 sm:-translate-x-1/2 lg:-bottom-8 lg:-left-10 lg:translate-x-0">
            <PhoneMock />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ live strip */

function TickNumber({ value, run }) {
  // Start at 0 when the tick-in will play (the card is still hidden until it
  // scrolls into view), so the number never flashes its final value first.
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  const started = useRef(false);
  useEffect(() => {
    if (value == null) return undefined;
    if (!run || started.current || prefersReducedMotion()) {
      if (run || started.current) setShown(value);
      return undefined;
    }
    started.current = true;
    const t0 = performance.now();
    let frame = 0;
    const step = (now) => {
      const p = (now - t0) / 900;
      setShown(tickValue(value, p));
      if (p < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [value, run]);
  return <span className="tabular-nums">{shown ?? value}</span>;
}

function LiveCard({ item, run, index }) {
  const { t } = useI18n();
  const minutesLine =
    item.minutes == null ? (
      <span className="text-2xl font-semibold text-text-secondary">{t("landing.liveNoEstimate")}</span>
    ) : item.minutes === 0 ? (
      <span className="font-display text-[2.25rem] leading-none font-semibold text-foreground">
        {t("landing.liveNoWait")}
      </span>
    ) : (
      <>
        <span className="font-metric text-[3rem] leading-none font-bold tracking-[-0.03em] text-foreground">
          <TickNumber value={item.minutes} run={run} />
        </span>
        <span className="ml-1.5 text-sm font-semibold text-text-secondary">{t("landing.liveMinutes")}</span>
      </>
    );
  return (
    <Reveal
      as="li"
      delay={index}
      data-testid="landing-live-card"
      data-name={item.name}
      className="flex min-w-0 flex-col justify-between gap-5 rounded-2xl border border-border bg-card p-5 shadow-card"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-heading text-title text-foreground">{item.name}</p>
          {item.place ? <p className="truncate text-sm text-text-secondary">{item.place}</p> : null}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
            item.state === "open" && "bg-primary-muted text-primary",
            item.state === "paused" && "bg-warning-soft text-warning-ink",
            item.state === "closed" && "bg-secondary text-text-secondary"
          )}
        >
          {t(`state.${item.state}`)}
        </span>
      </div>
      <div>
        <p className="flex items-baseline" data-testid="landing-live-wait">
          {minutesLine}
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          {t("landing.liveWaiting", { n: item.waiting })}
        </p>
      </div>
    </Reveal>
  );
}

function LiveStrip() {
  const { t } = useI18n();
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const listRef = useRef(null);
  const inView = useRevealed(listRef);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (document.visibilityState === "hidden") return;
      try {
        const data = await fetchStatusBoard();
        if (cancelled) return;
        setItems(landingStripItems(data?.queues));
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    load();
    const id = window.setInterval(load, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <section id="live" aria-labelledby="landing-live-title" className="scroll-mt-6 border-y border-border bg-secondary/60 py-16 sm:py-20">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <Reveal className="max-w-xl">
            <p className={cn(EYEBROW, "flex items-center gap-2 text-primary")}>
              <span className="landing-live-dot size-2 rounded-full bg-primary" aria-hidden="true" />
              {t("landing.navLive")}
            </p>
            <SectionTitle id="landing-live-title" className="mt-3">
              {t("landing.liveTitle")}
            </SectionTitle>
            <p className="mt-2 text-text-secondary">{t("landing.liveBody")}</p>
          </Reveal>
          <Link
            to={STATUS_BOARD_PATH}
            data-testid="landing-live-all"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
          >
            {t("landing.liveAll")}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div ref={listRef} className="mt-8">
          {items && items.length > 0 ? (
            <ul
              className={cn(
                "grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2",
                items.length >= 4 ? "lg:grid-cols-4" : items.length === 3 ? "lg:grid-cols-3" : null
              )}
              data-testid="landing-live-list"
            >
              {items.map((item, i) => (
                <LiveCard key={item.id} item={item} run={inView} index={i} />
              ))}
            </ul>
          ) : items ? (
            <p role="status" className={LIVE_NOTE} data-testid="landing-live-empty">
              {t("landing.liveEmpty")}
            </p>
          ) : failed ? (
            <p role="status" className={LIVE_NOTE} data-testid="landing-live-error">
              {t("landing.liveError")}
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <li key={i} className="h-[9.5rem] animate-pulse rounded-2xl border border-border bg-card/70 motion-reduce:animate-none" />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- how it works */

const STEPS = [
  { n: 1, img: "/landing/step-scan.webp" },
  { n: 2, img: "/landing/step-watch.webp" },
  { n: 3, img: "/landing/step-walk.webp" },
];

function HowItWorks() {
  const { t } = useI18n();
  return (
    <section id="how" aria-labelledby="landing-how-title" className="scroll-mt-6 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Reveal className="max-w-2xl">
          <p className={cn(EYEBROW, "text-primary")}>{t("landing.navHow")}</p>
          <SectionTitle id="landing-how-title" className="mt-3">
              {t("landing.howTitle")}
            </SectionTitle>
        </Reveal>
        <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-6 lg:gap-8">
          {STEPS.map((step, i) => (
            <Reveal as="li" key={step.n} delay={i} className="landing-step min-w-0" data-testid="landing-step">
              <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-card">
                <img
                  src={step.img}
                  width="800"
                  height="600"
                  loading="lazy"
                  decoding="async"
                  alt={t(`landing.how${step.n}Alt`)}
                  className="landing-step-img block aspect-[4/3] h-auto w-full object-cover"
                />
              </div>
              <div className="mt-5 flex items-baseline gap-3">
                <span className="font-display text-[2rem] leading-none font-semibold text-primary tabular-nums" aria-hidden="true">
                  {step.n}
                </span>
                <h3 className="font-heading text-title text-foreground">{t(`landing.how${step.n}Title`)}</h3>
              </div>
              <p className="mt-2 leading-relaxed text-text-secondary">{t(`landing.how${step.n}Body`)}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- for staff */

const BEST_TIME_BARS = [22, 38, 64, 92, 70, 44, 30, 18, 26, 48, 58, 34];
const QUIET_BAR = 7;

function ConsoleMock() {
  const { t } = useI18n();
  return (
    <div
      role="img"
      aria-label={t("landing.consoleLabel")}
      data-testid="landing-console"
      className="rounded-2xl border border-white/15 bg-[#fffcf7] p-5 text-[#1a1a18] shadow-dialog sm:p-6"
    >
      <div aria-hidden="true">
        <div className="flex items-center justify-between gap-3">
          <p className="font-heading text-title font-semibold">{t("landing.consoleQueue")}</p>
          <span className="rounded-full bg-[#d8f3dc] px-2 py-0.5 text-xs font-semibold text-[#1b4332]">{t("state.open")}</span>
        </div>
        <div className="mt-5 grid grid-cols-[auto_1fr] items-end gap-5">
          <div>
            <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-[#57534e] uppercase">{t("serving.now")}</p>
            <p className="font-metric text-[3rem] leading-none font-bold tracking-[-0.03em] tabular-nums">A26</p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-[#efece4] px-3 py-2">
              <p className="text-[#57534e]">{t("landing.consoleWaiting")}</p>
              <p className="text-lg font-bold tabular-nums">6</p>
            </div>
            <div className="rounded-lg bg-[#efece4] px-3 py-2">
              <p className="text-[#57534e]">{t("landing.consoleAvg")}</p>
              <p className="text-lg font-bold tabular-nums">{t("landing.consoleAvgValue", { n: "2.4" })}</p>
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="inline-flex h-10 items-center rounded-lg bg-[#1b4332] px-4 text-sm font-semibold text-[#f0fdf4]">
            {t("landing.consoleServe")}
          </span>
          <span className="inline-flex h-10 items-center rounded-lg border border-[#d6d3d1] px-4 text-sm font-semibold">
            {t("landing.consoleSkip")}
          </span>
          <span className="inline-flex h-10 items-center rounded-lg border border-[#d6d3d1] px-4 text-sm font-semibold">
            {t("landing.consolePause")}
          </span>
        </div>
        <div className="mt-6 border-t border-[#e7e5e4] pt-4">
          <p className="text-xs font-semibold text-[#57534e]">{t("landing.consoleBest")}</p>
          <div className="mt-3 flex h-20 items-end gap-1.5">
            {BEST_TIME_BARS.map((h, i) => (
              <span
                key={i}
                className={cn(
                  "landing-bar flex-1 rounded-t-sm",
                  i === QUIET_BAR ? "bg-[#bc6c25]" : "bg-[#1b4332]/75"
                )}
                style={{ height: `${h}%`, "--bar": i }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ForStaff() {
  const { t } = useI18n();
  return (
    <section id="staff" aria-labelledby="landing-staff-title" className="auth-brand relative scroll-mt-6 overflow-hidden py-20 sm:py-28">
      <div aria-hidden="true" className="auth-brand-glow pointer-events-none absolute inset-0" />
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
        <Reveal className="min-w-0">
          <p className={cn(EYEBROW, "text-[#b7e4c7]")}>{t("landing.staffEyebrow")}</p>
          <SectionTitle id="landing-staff-title" className="mt-3 max-w-[18ch] text-[#f0fdf4]">
            {t("landing.staffTitle")}
          </SectionTitle>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#d8f3dc]">{t("landing.staffBody")}</p>
          <ul className="mt-8 flex flex-col gap-3">
            {["landing.staffPoint1", "landing.staffPoint2", "landing.staffPoint3"].map((key) => (
              <li key={key} className="flex items-start gap-3 text-[#d8f3dc]">
                <QueueItMark className="mt-1 size-4 shrink-0 text-[#95d5b2]" />
                {t(key)}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={2} className="min-w-0">
          <ConsoleMock />
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- trust + end */

const TRUST = [
  { n: 1, Icon: Smartphone },
  { n: 2, Icon: Download },
  { n: 3, Icon: Languages },
  { n: 4, Icon: Clock },
];

function Trust() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="landing-trust-title" className="py-20 sm:py-24">
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <Reveal>
          <SectionTitle id="landing-trust-title">
            {t("landing.trustTitle")}
          </SectionTitle>
        </Reveal>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST.map(({ n, Icon }, i) => (
            <Reveal as="li" key={n} delay={i} className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <span className="grid size-10 place-items-center rounded-xl bg-primary-muted text-primary" aria-hidden="true">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 font-heading text-title text-foreground">{t(`landing.trust${n}Title`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-text-secondary">{t(`landing.trust${n}Body`)}</p>
            </Reveal>
          ))}
        </ul>

        <Reveal className="auth-brand relative mt-16 overflow-hidden rounded-[1.5rem] px-6 py-12 sm:px-12 sm:py-14">
          <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <SectionTitle className="text-[#f0fdf4]">
                {t("landing.finalTitle")}
              </SectionTitle>
              <p className="mt-3 text-lg text-[#d8f3dc]">{t("landing.finalBody")}</p>
            </div>
            <CtaPair testIdPrefix="landing-final" tone="inverse" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

/**
 * Public landing page at "/" for signed-out visitors (and Guests who are not
 * in a line). Signed-in people never see it: HomeRoute redirects them home.
 */
export function LandingPage() {
  const { t } = useI18n();

  useEffect(() => {
    document.title = t("landing.docTitle");
    return () => {
      document.title = "QueueIt";
    };
  }, [t]);

  return (
    <div className="landing min-h-dvh bg-background" data-testid="landing-page">
      <SkipToContent />
      <header className="relative z-10">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Wordmark to="/" />
          <nav aria-label={t("landing.navLabel")} className="hidden items-center gap-6 text-sm font-semibold text-text-secondary md:flex">
            <a href="#live" className="rounded outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">{t("landing.navLive")}</a>
            <a href="#how" className="rounded outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">{t("landing.navHow")}</a>
            <a href="#staff" className="rounded outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">{t("landing.navStaff")}</a>
          </nav>
          <div className="flex items-center gap-2">
            <LanguageToggle className="hidden sm:inline-flex" />
            <ThemeToggle />
            <Link
              to="/login"
              data-testid="landing-header-login"
              className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-primary outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {t("landing.login")}
            </Link>
          </div>
        </div>
      </header>

      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="outline-none">
        <Hero />
        <LiveStrip />
        <HowItWorks />
        <ForStaff />
        <Trust />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-text-secondary sm:px-6">
          <div className="flex items-center gap-4">
            <Wordmark to="/" />
            <span>{t("landing.footerNote")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-5 font-semibold">
            <Link to={STATUS_BOARD_PATH} className="hover:text-foreground">{t("landing.footerBoard")}</Link>
            <Link to="/login" className="hover:text-foreground">{t("landing.login")}</Link>
            <Link to="/register" className="hover:text-foreground">{t("landing.footerRegister")}</Link>
            <LanguageToggle className="sm:hidden" />
          </div>
        </div>
      </footer>
    </div>
  );
}
