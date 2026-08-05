import { Search, Plus, MapPin, Eye, Tag, ChevronLeft, ChevronRight, Filter, Compass, LayoutGrid, RefreshCw } from 'lucide-react';
import AuthenticatedImage from '../AuthenticatedImage';

// ส่วนแสดงผลของหน้าสถานที่ รับสถานะและคำสั่งจากตัวควบคุมหน้าเพื่อแยกการวาดหน้าจอออกจากการไหลของข้อมูล
const DestinationsView = ({
    navigate,
    sourceTotalCount,
    filters,
    setFilters,
    search,
    setSearch,
    handleSearch,
    handleBulkSyncTAT,
    bulkSyncing,
    placeCategories,
    statusCounts,
    loading,
    allItems,
    syncingId,
    handleSingleSyncTAT,
    handleDelete,
    page,
    totalPages,
    pageNumbers,
    handlePageChange
}) => {
    return (
        <div className="w-full space-y-3 p-3">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-3 bg-gradient-to-r from-gray-900 to-gray-800 p-3 rounded-xl border border-gray-800 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <div className="absolute bottom-0 left-10 w-40 h-40 bg-blue-500/5 rounded-full blur-2xl -mb-10 pointer-events-none" />

                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-500 text-xs font-bold tracking-widest uppercase">จัดการสถานที่</span>
                    </div>
                    <h1 className="text-xl md:text-2xl font-extrabold text-white tracking-tight">
                        สถานที่ท่องเที่ยว
                    </h1>
                    <p className="text-gray-400 mt-2 text-base max-w-xl leading-relaxed">
                        จัดการสถานที่ท่องเที่ยวจาก TAT API และสถานที่ที่ผู้ดูแลระบบเพิ่มเอง
                    </p>
                    {sourceTotalCount > 0 && (
                        <div className="flex items-center gap-2 mt-2">
                            <span className="bg-gray-800 text-gray-300 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-700">
                                ทั้งหมด: {sourceTotalCount.toLocaleString()} แห่ง
                            </span>
                            <span className="bg-gray-800/50 text-gray-400 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-700/50">
                                แหล่งข้อมูล: {filters.source === 'tat' ? 'TAT API' : 'ผู้ดูแลระบบเพิ่ม'}
                            </span>
                        </div>
                    )}
                </div>

                <div className="relative z-10 flex flex-col sm:flex-row gap-3 items-stretch lg:items-center">
                    <form onSubmit={handleSearch} className="relative group">
                        <Search
                            size={18}
                            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500"
                        />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="ค้นหาสถานที่..."
                            className="pl-10 pr-4 py-2.5 w-full sm:w-72 bg-black/40 border border-gray-700 focus:border-yellow-500/50 focus:ring-2 focus:ring-yellow-500/20 rounded-xl text-sm text-white shadow-inner outline-none"
                        />
                    </form>

                    {filters.source === 'tat' && (
                        <button
                            onClick={handleBulkSyncTAT}
                            disabled={bulkSyncing}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-emerald-600 disabled:from-gray-700 disabled:to-gray-800 disabled:text-gray-500 text-white font-bold rounded-xl shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:shadow-none disabled:transform-none"
                        >
                            <RefreshCw size={18} className={bulkSyncing ? 'animate-spin' : ''} />
                            {bulkSyncing ? 'กำลังซิงก์...' : 'ซิงก์ผลลัพธ์ TAT ทั้งหมด'}
                        </button>
                    )}

                    {filters.source === 'admin' && (
                        <button
                            onClick={() => navigate('/destinations/add')}
                            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold rounded-xl shadow-[0_0_15px_rgba(234,179,8,0.3)]"
                        >
                            <Plus size={18} />
                            เพิ่มสถานที่
                        </button>
                    )}
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-3">
                {/* Filters Sidebar */}
                <div className="lg:w-56 shrink-0 space-y-3">
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 shadow-xl sticky top-3">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                <Filter size={18} className="text-yellow-500" />
                                ตัวกรอง
                            </h3>
                            <button
                                onClick={() =>
                                    setFilters({ source: 'tat', status: 'all', placeCategory: 'all' })
                                }
                                className="text-xs font-semibold text-yellow-500/80 px-2 py-1 bg-yellow-500/10 rounded-lg"
                            >
                                ล้างค่า
                            </button>
                        </div>

                        {/* Source Filter */}
                        <div className="space-y-3">
                            <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3">แหล่งข้อมูล</p>

                            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${filters.source === 'tat' ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-black/20 border-transparent'}`}>
                                <input
                                    type="radio"
                                    name="source-filter"
                                    className="hidden"
                                    checked={filters.source === 'tat'}
                                    onChange={() => setFilters({ ...filters, source: 'tat', status: 'all' })}
                                />
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${filters.source === 'tat' ? 'border-yellow-500' : 'border-gray-500'}`}>
                                    {filters.source === 'tat' && <div className="w-2 h-2 rounded-full bg-yellow-500" />}
                                </div>
                                <span className={`text-sm font-medium ${filters.source === 'tat' ? 'text-yellow-400' : 'text-gray-400'}`}>TAT API</span>
                            </label>

                            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${filters.source === 'admin' ? 'bg-blue-500/10 border-blue-500/30' : 'bg-black/20 border-transparent'}`}>
                                <input
                                    type="radio"
                                    name="source-filter"
                                    className="hidden"
                                    checked={filters.source === 'admin'}
                                    onChange={() => setFilters({ ...filters, source: 'admin' })}
                                />
                                <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${filters.source === 'admin' ? 'border-blue-500' : 'border-gray-500'}`}>
                                    {filters.source === 'admin' && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                                </div>
                                <span className={`text-sm font-medium ${filters.source === 'admin' ? 'text-blue-400' : 'text-gray-400'}`}>ผู้ดูแลระบบเพิ่ม</span>
                            </label>
                        </div>

                        {/* Category Filter (TAT API only) */}
                        {filters.source === 'tat' && (
                            <div className="mt-5 pt-4 border-t border-gray-800 space-y-2">
                                <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3">หมวดหมู่</p>

                                {placeCategories.map((cat) => (
                                    <label
                                        key={cat.id}
                                        className={`flex items-center p-2.5 rounded-xl cursor-pointer group ${filters.placeCategory === cat.id ? 'bg-white/10' : 'hover:bg-white/5'}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <input
                                                type="radio"
                                                name="category-filter"
                                                className="hidden"
                                                checked={filters.placeCategory === cat.id}
                                                onChange={() => setFilters({ ...filters, placeCategory: cat.id })}
                                            />
                                            <div className="w-4 h-4 flex items-center justify-center">
                                                <div className={`w-2.5 h-2.5 rounded-full ${filters.placeCategory === cat.id ? 'bg-yellow-500' : 'bg-gray-600'}`} />
                                            </div>
                                            <span className={`text-sm ${filters.placeCategory === cat.id ? 'text-yellow-400 font-medium' : 'text-gray-400'}`}>{cat.label}</span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                        )}

                        {/* Status Filter (Admin Added only) */}
                        {filters.source === 'admin' && (
                        <div className="mt-5 pt-4 border-t border-gray-800 space-y-2">
                            <p className="text-xs text-gray-500 font-bold uppercase tracking-wider mb-3">สถานะ</p>

                            {[
                                { id: 'all', label: 'ทุกสถานะ', count: null },
                                { id: 'approved', label: 'อนุมัติแล้ว', count: statusCounts.approved },
                                { id: 'pending', label: 'รออนุมัติ', count: statusCounts.pending },
                                { id: 'rejected', label: 'ไม่อนุมัติ', count: statusCounts.rejected }
                            ].map((status) => (
                                <label key={status.id} className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer group ${filters.status === status.id ? 'bg-white/10' : 'hover:bg-white/5'}`}>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="radio"
                                            name="status-filter"
                                            className="hidden"
                                            checked={filters.status === status.id}
                                            onChange={() => setFilters({ ...filters, status: status.id })}
                                        />
                                        <div className={`w-4 h-4 flex items-center justify-center`}>
                                            <div className={`w-2.5 h-2.5 rounded-full ${filters.status === status.id ? 'bg-white' : 'bg-gray-600'}`} />
                                        </div>
                                        <span className={`text-sm ${filters.status === status.id ? 'text-white font-medium' : 'text-gray-400'}`}>{status.label}</span>
                                    </div>
                                    {status.count !== null && (
                                        <span className="text-xs bg-black/40 text-gray-400 px-2 py-1 rounded-md">{status.count}</span>
                                    )}
                                </label>
                            ))}
                        </div>
                        )}
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <LayoutGrid size={20} className="text-gray-400" />
                            รายการสถานที่
                        </h2>
                    </div>

                    {loading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {Array.from({ length: 6 }).map((_, i) => (
                                <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                                    <div className="h-40 bg-gray-800" />
                                    <div className="p-3 space-y-2">
                                        <div className="h-5 bg-gray-800 rounded-md w-3/4" />
                                        <div className="flex gap-2">
                                            <div className="h-4 bg-gray-800 rounded-md w-1/4" />
                                            <div className="h-4 bg-gray-800 rounded-md w-1/4" />
                                        </div>
                                        <div className="h-10 bg-gray-800 rounded-xl w-full mt-4" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                            {allItems.map((item, i) => (
                                <div
                                    key={`${item.source}-${item.id}-${i}`}
                                    className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden group flex flex-col"
                                >
                                    <div className="h-36 bg-gray-800 relative overflow-hidden">
                                        {item.image ? (
                                            <AuthenticatedImage
                                                src={item.image}
                                                alt={item.name}
                                                loading="lazy"
                                                decoding="async"
                                                className="w-full h-full object-cover duration-700 ease-in-out"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                                                <Compass size={40} className="text-gray-600 mb-2" />
                                                <span className="text-xs text-gray-500">ไม่มีรูปภาพ</span>
                                            </div>
                                        )}

                                        {/* Overlay Gradient */}
                                        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/20 to-transparent" />

                                        {/* Badges */}
                                            <div className="absolute top-4 right-4 flex flex-col gap-2 items-end">
                                                <span
                                                    className={`px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase rounded-lg backdrop-blur-md border ${
                                                        (item.source === 'tat_api' || item.source === 'tat_synced')
                                                            ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
                                                            : 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                                                    }`}
                                                >
                                                    {(item.source === 'tat_api' || item.source === 'tat_synced') ? 'TAT API' : 'ผู้ดูแลระบบ'}
                                                </span>
                                                {item.status === 'approved' && (item.source === 'admin' || item.source === 'tat_synced') && (
                                                <span className="px-2 py-1 bg-emerald-500/80 backdrop-blur-md text-white text-[10px] font-bold rounded-lg border border-emerald-400/50">
                                                    อนุมัติแล้ว
                                                </span>
                                            )}
                                            {item.status === 'pending' && (
                                                <span className="px-2 py-1 bg-amber-500/80 backdrop-blur-md text-white text-[10px] font-bold rounded-lg border border-amber-400/50">
                                                    รออนุมัติ
                                                </span>
                                            )}
                                            {item.status === 'rejected' && (
                                                <span className="px-2 py-1 bg-rose-500/80 backdrop-blur-md text-white text-[10px] font-bold rounded-lg border border-rose-400/50">
                                                    ไม่อนุมัติ
                                                </span>
                                            )}
                                        </div>

                                        <div className="absolute bottom-4 left-4 right-4">
                                            <h3 className="font-bold text-lg text-white truncate text-shadow-sm">
                                                {item.name}
                                            </h3>
                                        </div>
                                    </div>

                                    <div className="p-3 flex-1 flex flex-col">
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
                                            <p className="text-xs text-gray-400 flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                                                <MapPin size={12} className="text-gray-500" />
                                                <span className="truncate max-w-[120px]">{item.province || 'ไม่ระบุ'}</span>
                                            </p>

                                            {item.category && (
                                                <p className="text-xs text-gray-400 flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                                                    <Tag size={12} className="text-gray-500" />
                                                    <span className="truncate max-w-[100px]">{item.category}</span>
                                                </p>
                                            )}

                                            {item.viewer > 0 && (
                                                <span className="text-xs text-gray-400 flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded-md border border-white/5">
                                                    <Eye size={12} className="text-gray-500" />
                                                    {item.viewer.toLocaleString()}
                                                </span>
                                            )}
                                        </div>

                                        {item.tags?.length > 0 && (
                                            <div className="flex gap-1.5 flex-wrap mb-3">
                                                {item.tags.slice(0, 3).map((tag, idx) => (
                                                    <span
                                                        key={idx}
                                                        className="text-[10px] px-2 py-1 rounded-lg bg-black/40 text-gray-400 border border-gray-800"
                                                    >
                                                        #{tag}
                                                    </span>
                                                ))}
                                                {item.tags.length > 3 && (
                                                    <span className="text-[10px] px-2 py-1 rounded-lg bg-black/40 text-gray-500 border border-gray-800">
                                                        +{item.tags.length - 3}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        <div className="mt-auto pt-3 flex gap-2">
                                            {item.source === 'tat_api' ? (
                                                <>
                                                    <button
                                                        onClick={() => navigate(`/destinations/read-tat/${item.id}`, { state: { introduction: item.introduction } })}
                                                        className="flex-1 py-2 bg-white/5 text-white text-sm font-semibold rounded-xl border border-gray-700 text-center flex items-center justify-center gap-2"
                                                    >
                                                        <Eye size={16} />
                                                        ดูข้อมูล
                                                    </button>
                                                    <button
                                                        onClick={() => handleSingleSyncTAT(item.id, item.name)}
                                                        disabled={syncingId === item.id}
                                                        className="flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-emerald-600 px-2 py-2 text-center text-sm font-semibold text-white shadow-lg shadow-emerald-500/10 disabled:bg-gray-800 disabled:text-gray-500 disabled:shadow-none"
                                                    >
                                                        <RefreshCw size={16} className={syncingId === item.id ? 'animate-spin' : ''} />
                                                        {syncingId === item.id ? 'กำลังซิงก์' : 'ซิงก์ข้อมูล'}
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <button
                                                        onClick={() => navigate(`/destinations/edit/${item.id}`)}
                                                        className="flex-1 py-2 bg-yellow-500 text-white text-sm font-semibold rounded-xl text-center shadow-lg shadow-yellow-500/20"
                                                    >
                                                        แก้ไข
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(item.id)}
                                                        className="flex-1 py-2 bg-red-500/10 text-red-500 text-sm font-semibold rounded-xl text-center border border-red-500/20"
                                                    >
                                                        ลบ
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {allItems.length === 0 && !loading && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 flex flex-col items-center justify-center text-center">
                            <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                                <Search size={32} className="text-gray-500" />
                            </div>
                            <h3 className="text-xl font-bold text-white mb-2">ไม่พบสถานที่</h3>
                            <p className="text-gray-500 max-w-sm">
                                ลองเปลี่ยนคำค้นหาหรือตัวกรอง หรือเพิ่มสถานที่ใหม่ด้วยตนเอง
                            </p>
                        </div>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 shadow-lg">
                            <p className="text-sm text-gray-400">
                                หน้า <span className="text-white font-medium">{page}</span> จาก <span className="text-white font-medium">{totalPages}</span>
                            </p>

                            <div className="flex items-center gap-1.5 bg-black/30 p-1.5 rounded-xl border border-gray-800">
                                <button
                                    onClick={() => handlePageChange(page - 1)}
                                    disabled={page <= 1}
                                    className="p-2 rounded-lg text-gray-400 disabled:opacity-30"
                                >
                                    <ChevronLeft size={18} />
                                </button>

                                {pageNumbers[0] > 1 && (
                                    <>
                                        <button
                                            onClick={() => handlePageChange(1)}
                                            className="w-10 h-10 rounded-lg text-sm font-medium text-gray-400"
                                        >
                                            1
                                        </button>
                                        {pageNumbers[0] > 2 && (
                                            <span className="text-gray-600 px-1">...</span>
                                        )}
                                    </>
                                )}

                                {pageNumbers.map((p) => (
                                    <button
                                        key={p}
                                        onClick={() => handlePageChange(p)}
                                        className={`w-10 h-10 rounded-lg text-sm font-medium ${
                                            p === page
                                                ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20'
                                                : 'text-gray-400'
                                        }`}
                                    >
                                        {p}
                                    </button>
                                ))}

                                {pageNumbers[pageNumbers.length - 1] < totalPages && (
                                    <>
                                        {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && (
                                            <span className="text-gray-600 px-1">...</span>
                                        )}
                                        <button
                                            onClick={() => handlePageChange(totalPages)}
                                            className="w-10 h-10 rounded-lg text-sm font-medium text-gray-400"
                                        >
                                            {totalPages}
                                        </button>
                                    </>
                                )}

                                <button
                                    onClick={() => handlePageChange(page + 1)}
                                    disabled={page >= totalPages}
                                    className="p-2 rounded-lg text-gray-400 disabled:opacity-30"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DestinationsView;
