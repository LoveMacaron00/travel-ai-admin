import { useMemo, useState } from 'react';

const width = 760;
const height = 260;
const padding = { top: 20, right: 20, bottom: 42, left: 48 };
const plotWidth = width - padding.left - padding.right;
const plotHeight = height - padding.top - padding.bottom;

const toPath = (points, yField) => points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point[yField]}`)
    .join(' ');

const UsageTrendChart = ({ data, viewLabel = 'Destination views' }) => {
    const [hoveredIndex, setHoveredIndex] = useState(null);
    const chart = useMemo(() => {
        const maxValue = Math.max(
            ...data.flatMap((point) => [point.activeUsers, point.destinationViews]),
            1,
        );
        const ceiling = Math.max(4, Math.ceil(maxValue / 4) * 4);
        const points = data.map((point, index) => {
            const x = padding.left + (
                data.length === 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth
            );
            return {
                ...point,
                x,
                activeY: padding.top + plotHeight - (point.activeUsers / ceiling) * plotHeight,
                viewsY: padding.top + plotHeight - (point.destinationViews / ceiling) * plotHeight,
            };
        });
        const activePath = toPath(points, 'activeY');
        const viewsPath = toPath(points, 'viewsY');
        const areaPath = points.length > 0
            ? `${activePath} L ${points.at(-1).x} ${padding.top + plotHeight} L ${points[0].x} ${padding.top + plotHeight} Z`
            : '';
        const labelIndexes = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])]
            .filter((index) => index >= 0);

        return { activePath, areaPath, ceiling, labelIndexes, points, viewsPath };
    }, [data]);

    const hovered = hoveredIndex == null ? null : chart.points[hoveredIndex];

    return (
        <div
            className="relative h-72 w-full"
            role="img"
            aria-label="Active users and destination views trend chart"
        >
            <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`}>
                <defs>
                    <linearGradient id="usage-area" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#10B981" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="#10B981" stopOpacity="0.02" />
                    </linearGradient>
                </defs>

                {[0, 1, 2, 3, 4].map((step) => {
                    const y = padding.top + (step / 4) * plotHeight;
                    const value = Math.round(chart.ceiling - (step / 4) * chart.ceiling);
                    return (
                        <g key={step}>
                            <line
                                x1={padding.left}
                                x2={width - padding.right}
                                y1={y}
                                y2={y}
                                stroke="#374151"
                                strokeDasharray="4 6"
                                strokeWidth="1"
                            />
                            <text x={padding.left - 12} y={y + 4} fill="#6B7280" fontSize="11" textAnchor="end">
                                {value}
                            </text>
                        </g>
                    );
                })}

                {chart.areaPath && <path d={chart.areaPath} fill="url(#usage-area)" />}
                {chart.activePath && (
                    <path
                        d={chart.activePath}
                        fill="none"
                        stroke="#10B981"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="3"
                    />
                )}
                {chart.viewsPath && (
                    <path
                        d={chart.viewsPath}
                        fill="none"
                        stroke="#F59E0B"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="3"
                    />
                )}

                {chart.points.map((point, index) => (
                    <g key={point.key}>
                        <rect
                            x={point.x - Math.max(4, plotWidth / Math.max(data.length, 1) / 2)}
                            y={padding.top}
                            width={Math.max(8, plotWidth / Math.max(data.length, 1))}
                            height={plotHeight}
                            fill="transparent"
                            onMouseEnter={() => setHoveredIndex(index)}
                            onMouseLeave={() => setHoveredIndex(null)}
                        />
                        <circle
                            cx={point.x}
                            cy={point.activeY}
                            r={hoveredIndex === index ? 5 : 3}
                            fill="#111827"
                            stroke="#34D399"
                            strokeWidth="2"
                        />
                        <circle
                            cx={point.x}
                            cy={point.viewsY}
                            r={hoveredIndex === index ? 5 : 3}
                            fill="#111827"
                            stroke="#FBBF24"
                            strokeWidth="2"
                        >
                            <title>{`${point.label}: ${point.activeUsers} active users, ${point.destinationViews} ${viewLabel}`}</title>
                        </circle>
                    </g>
                ))}

                {chart.labelIndexes.map((index) => {
                    const point = chart.points[index];
                    return point ? (
                        <text
                            key={point.key}
                            x={point.x}
                            y={height - 12}
                            fill="#6B7280"
                            fontSize="11"
                            fontWeight="600"
                            textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}
                        >
                            {point.label}
                        </text>
                    ) : null;
                })}
            </svg>

            {hovered && (
                <div
                    className="pointer-events-none absolute top-2 z-10 min-w-36 -translate-x-1/2 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-xs shadow-xl"
                    style={{ left: `${(hovered.x / width) * 100}%` }}
                >
                    <p className="font-bold text-white">{hovered.label}</p>
                    <p className="mt-1 text-emerald-400">{hovered.activeUsers} active users</p>
                    <p className="mt-0.5 text-amber-400">{hovered.destinationViews} {viewLabel}</p>
                    <p className="mt-0.5 text-gray-500">{hovered.uniqueDestinationViewers} unique viewers</p>
                </div>
            )}
        </div>
    );
};

export default UsageTrendChart;
