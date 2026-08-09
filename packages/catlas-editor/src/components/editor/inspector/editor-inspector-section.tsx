import type { ReactNode, Ref } from "react";

export function InspectorSection({
  children,
  headingRef,
  headingTabIndex,
  title,
}: {
  children: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  headingTabIndex?: number;
  title: string;
}) {
  return (
    <section className="form-section border-b border-border/60 px-3 py-3.5 last:border-b-0">
      <h3
        className="mb-2.5 mt-0 text-[11px] font-semibold text-foreground"
        ref={headingRef}
        tabIndex={headingTabIndex}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}
