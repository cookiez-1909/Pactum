// Shared motion. All of it respects the user's reduced motion setting.
import { useEffect, useRef, useState, type ReactNode } from "react";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Fades in when scrolled into view.
export function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || reducedMotion() || !("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`reveal ${visible ? "is-visible" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

// Counts up from 0 to the real value when it appears.
export function CountUp({ value, format }: { value: number; format: (value: number) => string }) {
  const [shown, setShown] = useState(reducedMotion() ? value : 0);
  const previous = useRef(0);

  useEffect(() => {
    if (reducedMotion()) {
      setShown(value);
      return;
    }
    const from = previous.current;
    const started = performance.now();
    let frame = 0;
    const step = (time: number) => {
      const progress = Math.min(1, (time - started) / 900);
      const eased = 1 - (1 - progress) ** 3;
      setShown(from + (value - from) * eased);
      if (progress < 1) frame = requestAnimationFrame(step);
      else previous.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{format(shown)}</>;
}
