import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { getHelpGuide, helpGuides } from "../../../content/help-guides";

export function generateStaticParams() {
  return helpGuides.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const guide = getHelpGuide((await params).slug);
  if (!guide) return { title: "Guide not found" };
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `https://www.doodlenote.ai/help/${guide.slug}` },
    openGraph: {
      title: `${guide.title} | DoodleNote Help`,
      description: guide.description,
      url: `https://www.doodlenote.ai/help/${guide.slug}`,
    },
  };
}

export default async function GuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const guide = getHelpGuide((await params).slug);
  if (!guide) notFound();
  const index = helpGuides.indexOf(guide);
  const adjacent = [
    { label: "Previous guide", guide: helpGuides[index - 1] },
    { label: "Next guide", guide: helpGuides[index + 1] },
  ];
  return (
    <main id="help-main" className="help-article-layout" tabIndex={-1}>
      <article className="help-article">
        <nav className="help-breadcrumb" aria-label="Breadcrumb">
          <Link href="/help">Help &amp; guides</Link>
          <span aria-hidden="true">/</span>
          <span>{guide.category}</span>
        </nav>
        <header className="help-article-header">
          <h1>{guide.title}</h1>
          <p>{guide.description}</p>
          <span className="help-platforms">{guide.platforms}</span>
        </header>
        <details className="help-mobile-outline">
          <summary>On this page</summary>
          <ul>
            {guide.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ul>
        </details>
        {guide.sections.map((section, sectionIndex) => (
          <div key={section.id}>
            <section
              className="help-article-section"
              aria-labelledby={section.id}
            >
              <h2 id={section.id}>
                <a href={`#${section.id}`}>
                  {section.title}
                  <span className="help-anchor" aria-hidden="true">
                    #
                  </span>
                </a>
              </h2>
              <div className="help-prose">
                <ReactMarkdown>{section.body}</ReactMarkdown>
              </div>
            </section>
            {sectionIndex === 0 && guide.image && (
              <figure className="help-figure">
                <Image
                  src={guide.image.src}
                  alt={guide.image.alt}
                  width={1800}
                  height={1102}
                  sizes="(max-width: 800px) 100vw, 700px"
                  className="help-product-image"
                />
                <figcaption>{guide.image.caption}</figcaption>
              </figure>
            )}
          </div>
        ))}
        <section className="help-related">
          <h2>Keep going</h2>
          <div>
            {guide.related.map((slug) => {
              const related = getHelpGuide(slug)!;
              return (
                <Link href={`/help/${slug}`} key={slug}>
                  {related.title}
                  <span aria-hidden="true">→</span>
                </Link>
              );
            })}
          </div>
        </section>
        <div className="help-article-feedback">
          <span>Something missing or unclear?</span>
          <a
            href={`mailto:team@onyxdev.io?subject=${encodeURIComponent(`Help guide: ${guide.title}`)}&body=${encodeURIComponent(`About https://www.doodlenote.ai/help/${guide.slug}\n\n`)}`}
          >
            Email feedback <span aria-hidden="true">→</span>
          </a>
        </div>
        <nav className="help-pagination" aria-label="Adjacent guides">
          {adjacent.map(({ label, guide: item }) =>
            item ? (
              <Link href={`/help/${item.slug}`} key={label}>
                <span>{label}</span>
                <strong>
                  {label === "Previous guide" ? "← " : ""}
                  {item.title}
                  {label === "Next guide" ? " →" : ""}
                </strong>
              </Link>
            ) : (
              <span key={label} />
            ),
          )}
        </nav>
      </article>
      <aside className="help-outline">
        <nav aria-label="On this page">
          <h2>On this page</h2>
          <ul>
            {guide.sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="help-outline-support">
          <span>A little stuck?</span>
          <Link href="/contact">We’re here to help →</Link>
        </div>
      </aside>
    </main>
  );
}
