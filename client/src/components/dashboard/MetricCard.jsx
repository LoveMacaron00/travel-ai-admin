import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

const toneClasses = {
    blue: 'bg-blue-500/10 text-blue-400 ring-blue-500/20',
    emerald: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
    amber: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
    cyan: 'bg-cyan-500/10 text-cyan-400 ring-cyan-500/20',
    violet: 'bg-violet-500/10 text-violet-400 ring-violet-500/20',
};

const MetricCard = ({ icon: Icon, label, value, detail, tone, growth }) => {
    const hasGrowth = typeof growth === 'number';
    const growthIsPositive = hasGrowth && growth >= 0;

    return (
        <article className="relative overflow-hidden rounded-xl border border-gray-800 bg-gray-900 p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
                <div className={`rounded-lg p-2.5 ring-1 ${toneClasses[tone]}`}>
                    <Icon aria-hidden="true" size={18} />
                </div>
                {hasGrowth && (
                    <span
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-bold ${
                            growthIsPositive
                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                                : 'border-rose-500/20 bg-rose-500/10 text-rose-400'
                        }`}
                    >
                        {growthIsPositive
                            ? <ArrowUpRight aria-hidden="true" size={13} />
                            : <ArrowDownRight aria-hidden="true" size={13} />}
                        {growthIsPositive ? '+' : ''}{growth}%
                    </span>
                )}
            </div>
            <p className="mt-4 text-sm font-semibold text-gray-400">{label}</p>
            <p className="mt-1 text-2xl font-extrabold tracking-tight text-white md:text-3xl">{value}</p>
            <p className="mt-2 min-h-5 text-xs leading-5 text-gray-500">{detail}</p>
        </article>
    );
};

export default MetricCard;
