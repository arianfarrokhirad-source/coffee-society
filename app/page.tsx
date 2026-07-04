import Link from 'next/link'

export default function HomePage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      {/* Hero */}
      <section className="mb-20">
        <div className="text-blood text-xs uppercase tracking-[0.3em] mb-6">
          Est. anno domini — a study
        </div>
        <h1 className="serif text-5xl sm:text-7xl font-black leading-[0.95] mb-8">
          A short history of the bean that changed the world.
        </h1>
        <p className="text-ash text-lg leading-relaxed max-w-2xl">
          Long before the espresso machine, before the paper cup, before the
          morning meeting — there was a shepherd, a goat, and a small red
          cherry. This is the story of what happened next.
        </p>
      </section>

      <div className="h-px bg-line mb-16" />

      {/* Origin */}
      <Section
        chapter="I."
        title="The Ethiopian Highlands, c. 850 AD"
      >
        <p>
          The legend belongs to a goatherd named <em>Kaldi</em>. He noticed his
          flock refused to sleep at night after chewing the bright red cherries
          of a certain wild bush. He tried them himself, felt his own mind
          quicken, and brought them to the monks of a nearby monastery. The
          monks, at first suspicious, threw the beans into the fire — and the
          smell that rose was so intoxicating they raked them out, ground the
          roasted seeds, and steeped them in hot water.
        </p>
        <p>
          Whether the legend is true or not, this much is certain: the plant
          <em> Coffea arabica</em> is native to the forests of southwestern
          Ethiopia. Every cup of arabica coffee ever brewed traces back to
          those hills.
        </p>
      </Section>

      {/* Arab world */}
      <Section
        chapter="II."
        title="The Wine of Araby, 15th century"
      >
        <p>
          By the 1400s, coffee had crossed the Red Sea to Yemen. Sufi monks in
          Mocha used it to stay awake through their long night prayers. From
          Yemen it moved to Mecca, Cairo, Damascus, and Istanbul, and with it
          came something new to the world: <strong className="text-bone">the coffee house</strong>.
        </p>
        <p>
          These were called <em>qahveh khaneh</em> — houses of coffee — and
          they were the first public spaces in history where men gathered not
          to worship, not to trade, and not to drink alcohol, but simply to
          talk. Music was played. Poetry was recited. Politics was debated.
          The authorities noticed. Coffee was banned three times in Mecca,
          twice in the Ottoman Empire, and once, briefly, by the Pope — until
          he tasted it, and gave it his blessing.
        </p>
      </Section>

      {/* Europe */}
      <Section
        chapter="III."
        title="The Penny University, 17th century"
      >
        <p>
          Coffee reached Venice through trade with the Ottomans, then spread
          quickly to Vienna, Paris, and London. In England, a single coffee
          house on St Michael&apos;s Alley opened in 1652 — within fifty years
          there were three thousand of them. They were nicknamed
          <em> penny universities</em>: for the price of a coffee, any man
          could sit and listen to lawyers, poets, merchants, and philosophers
          argue for hours.
        </p>
        <p>
          Lloyd&apos;s of London began as a coffee house for shipping
          insurance. The London Stock Exchange began at Jonathan&apos;s Coffee
          House. Voltaire is said to have drunk forty cups a day at Café
          Procope in Paris. The Enlightenment did not happen in a library. It
          happened over a cup.
        </p>
      </Section>

      {/* Modern */}
      <Section
        chapter="IV."
        title="The Third Wave, present day"
      >
        <p>
          The twentieth century industrialised coffee. Instant granules,
          vacuum-sealed tins, drive-through counters. Coffee became fuel.
        </p>
        <p>
          The third wave — beginning in the early 2000s — pushed back. Single
          origin. Light roasts. The name of the farmer on the bag. The bean
          became, once again, an object of study: terroir, elevation,
          fermentation. The café, at its best, became once again what it was
          in Istanbul in 1550 — a room where strangers meet, talk, and think.
        </p>
      </Section>

      <div className="h-px bg-line my-16" />

      {/* Benefits */}
      <section className="mb-16">
        <div className="text-rust text-xs uppercase tracking-[0.3em] mb-6">
          On its quiet gifts
        </div>
        <h2 className="serif text-4xl font-black mb-8">
          What coffee has given us.
        </h2>
        <div className="grid sm:grid-cols-2 gap-8 text-ash leading-relaxed">
          <div>
            <h3 className="serif text-bone text-xl mb-2">A place to think.</h3>
            <p>
              The café is a rare third space — not home, not work — where a
              person can sit for hours with no obligation but to be present.
              Whole novels, treaties, and movements have been born at its
              tables.
            </p>
          </div>
          <div>
            <h3 className="serif text-bone text-xl mb-2">A quiet ritual.</h3>
            <p>
              The grinding of the beans, the water on the ground, the pause
              before the first sip. Coffee slows the beginning of the day into
              something you can pay attention to.
            </p>
          </div>
          <div>
            <h3 className="serif text-bone text-xl mb-2">A social bridge.</h3>
            <p>
              &ldquo;Let&apos;s get a coffee&rdquo; is one of the most
              universal invitations in modern life. Business is done, friends
              are made, and grief is shared over the same small cup.
            </p>
          </div>
          <div>
            <h3 className="serif text-bone text-xl mb-2">A body of study.</h3>
            <p>
              Moderate coffee consumption is linked in the research literature
              to lower rates of Parkinson&apos;s, type 2 diabetes, and certain
              liver diseases. A drink and a medicine, at once.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <div className="border border-line p-8 text-center bg-char">
        <div className="text-blood text-xs uppercase tracking-[0.3em] mb-4">
          The reading room is open
        </div>
        <h3 className="serif text-3xl mb-4">
          Have a question about coffee?
        </h3>
        <p className="text-ash mb-6 max-w-lg mx-auto">
          Ask about origin, brewing, history, health, or ritual. We read every
          question and answer them here, in public, for everyone.
        </p>
        <Link
          href="/ask"
          className="inline-block px-8 py-3 bg-blood text-bone hover:bg-rust transition font-medium"
        >
          Ask a question →
        </Link>
      </div>
    </div>
  )
}

function Section({
  chapter,
  title,
  children,
}: {
  chapter: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-16">
      <div className="flex items-baseline gap-4 mb-6">
        <span className="serif text-blood text-3xl italic">{chapter}</span>
        <h2 className="serif text-3xl sm:text-4xl font-black text-bone">{title}</h2>
      </div>
      <div className="space-y-4 text-ash leading-relaxed text-lg max-w-2xl">
        {children}
      </div>
    </section>
  )
}
