import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, MapPin, Clock, Info, Image as ImageIcon, Map, Building, RefreshCw, Ticket } from 'lucide-react';
import api from '../utils/api';
import ImageLightbox from '../components/ImageLightbox';
import AuthenticatedImage from '../components/AuthenticatedImage';
import { showErrorAlert, showSuccessAlert, showConfirmAlert } from '../utils/alerts';

const ReadDestination = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const navIntroduction = location.state?.introduction || '';
    const [place, setPlace] = useState(null);
    const [loading, setLoading] = useState(true);
    const [lightboxIndex, setLightboxIndex] = useState(null);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
        const fetchPlace = async () => {
            try {
                const res = await api.get(`/v2/places/${id}`, {
                    headers: { 'Accept-Language': 'th' }
                });
                const data = res.data;
                setPlace(data?.data || data?.result || data);
            } catch (err) {
                console.error('เกิดข้อผิดพลาดในการโหลดข้อมูล:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchPlace();
    }, [id]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && lightboxIndex == null) {
                navigate('/destinations');
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [lightboxIndex, navigate]);

    const name = place?.place_name || place?.placeName || place?.name || '';

    const handleSync = async () => {
        const result = await showConfirmAlert({
            title: 'Sync สถานที่นี้?',
            text: `ต้องการดึงข้อมูล "${name}" เข้าฐานข้อมูลและทำ Embedding ใช่หรือไม่?`,
            confirmButtonText: 'เริ่ม Sync',
            cancelButtonText: 'ยกเลิก'
        });

        if (!result.isConfirmed) return;

        setSyncing(true);
        try {
            await api.post(`/admin/sync/tat/${id}`);
            await showSuccessAlert(`Sync และทำ Embedding สำหรับ "${name}" สำเร็จแล้ว!`);
            navigate('/destinations');
        } catch (err) {
            console.error('เกิดข้อผิดพลาดในการ Sync รายบุคคล:', err);
            await showErrorAlert(err.response?.data?.message || 'Sync สถานที่ไม่สำเร็จ');
        } finally {
            setSyncing(false);
        }
    };

    if (loading) return <div className="p-6 text-gray-400">กำลังโหลดข้อมูล...</div>;
    if (!place) return <div className="p-6 text-gray-400">ไม่พบข้อมูลสถานที่</div>;

    // Helper to safely extract name
    const extractName = (val) => {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (Array.isArray(val)) return val[0] || '';
        if (typeof val === 'object') return val.name || val.provinceName || val.province_name || '';
        return '';
    };

    const tatLocation = place.location && typeof place.location === 'object' ? place.location : {};
    const provinceData = tatLocation.province && typeof tatLocation.province === 'object'
        ? tatLocation.province
        : {};
    const districtData = tatLocation.district && typeof tatLocation.district === 'object'
        ? tatLocation.district
        : {};
    const subDistrictData = tatLocation.subDistrict && typeof tatLocation.subDistrict === 'object'
        ? tatLocation.subDistrict
        : {};

    const address = tatLocation.address ?? place.address ?? '';
    const provinceId = provinceData.provinceId ?? place.province_id ?? '';
    const provinceName = extractName(provinceData)
        || extractName(place.province)
        || place.province_name
        || place.provinceName
        || '';
    const districtId = districtData.districtId ?? place.district_id ?? '';
    const districtName = extractName(districtData)
        || extractName(place.district)
        || place.district_name
        || '';
    const subDistrictId = subDistrictData.subDistrictId ?? place.sub_district_id ?? '';
    const subDistrictName = extractName(subDistrictData)
        || extractName(place.subDistrict)
        || place.sub_district
        || '';
    const postcode = tatLocation.postcode ?? place.postcode ?? '';
    const headerLocation = address || provinceName || 'Unknown Location';

    const rawDesc = place.information?.detail || place.detail || place.description || place.sha?.detail || place.place_information?.detail || place.introduction || navIntroduction || '';
    const desc = rawDesc.replace(/<\/?p>/gi, '').replace(/<\/?strong>/gi, '');
    const lat = place.latitude || place.location?.latitude || '';
    const lng = place.longitude || place.location?.longitude || '';

    const hours = place.openingHours || place.opening_hours || [];
    const fmt = (s) => (s || '').replace(/:00$/g, '');
    const openTime = Array.isArray(hours)
        ? (() => {
            const items = hours.map(h => {
                if (typeof h === 'string') return h;
                const d = h.day || h.weekday || '';
                const t = h.time || h.openTime || (h.open && h.close ? `${fmt(h.open)} - ${fmt(h.close)}` : '') || (h.openTime && h.closeTime ? `${fmt(h.openTime)} - ${fmt(h.closeTime)}` : '');
                return d ? { day: d, time: t } : { day: '', time: t };
            }).filter(Boolean);
            const allSame = items.length > 0 && items.every(i => i.time === items[0].time);
            if (allSame) return `ทุกวัน: ${items[0].time}`;
            return items.map(i => `${i.day}: ${i.time}`).join('\n');
          })()
        : typeof hours === 'string' ? hours : '';

    const fee = place.information?.fee || place.fee || {};
    const feeRows = [
        fee.thaiAdult != null && { label: 'Thai adult', value: `${fee.thaiAdult} THB` },
        fee.thaiChild != null && { label: 'Thai child', value: `${fee.thaiChild} THB` },
        fee.foreignerAdult != null && { label: 'Foreigner adult', value: `${fee.foreignerAdult} THB` },
        fee.foreignerChild != null && { label: 'Foreigner child', value: `${fee.foreignerChild} THB` },
    ].filter(Boolean);
    const feeDetail = fee.detail || '';

    // Combine all possible image URLs from TAT API or DB
    let allImages = [];

    // If it's a DB synced item, it might have `images` array of objects {url: ...}
    if (place.images && Array.isArray(place.images)) {
        if (typeof place.images[0] === 'object') {
            allImages.push(...place.images.map(img => img.image_url || img.url));
        } else {
            allImages.push(...place.images);
        }
    }

    // Add fields commonly found in TAT API
    if (place.thumbnailUrl) allImages.push(place.thumbnailUrl);
    if (place.image_url) allImages.push(place.image_url);
    if (place.desktopImageUrls) allImages.push(...place.desktopImageUrls);
    if (place.mobileImageUrls) allImages.push(...place.mobileImageUrls);
    if (place.picture_urls) allImages.push(...place.picture_urls);
    if (place.web_picture_urls) allImages.push(...place.web_picture_urls);
    if (place.multimedia) allImages.push(...place.multimedia.map(m => m.url));

    if (place.sha?.detailPicture) {
        const shaImgs = Array.isArray(place.sha.detailPicture) ? place.sha.detailPicture : [place.sha.detailPicture];
        allImages.push(...shaImgs);
    }

    // Clean and deduplicate
    const images = [...new Set(allImages.filter(url => typeof url === 'string' && url.trim().length > 0))];

    return (
        <div className="p-3 md:p-4 w-full space-y-4">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 bg-gradient-to-r from-gray-900 to-gray-800 p-4 rounded-xl border border-gray-800 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <div className="absolute bottom-0 left-10 w-40 h-40 bg-blue-500/5 rounded-full blur-2xl -mb-10 pointer-events-none" />

                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-bold tracking-widest uppercase border border-blue-500/20">Destination Details</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white tracking-tight">
                        {name || 'Loading...'}
                    </h1>
                    <div className="flex items-center gap-2 text-gray-400 mt-2 text-sm font-medium">
                        <MapPin size={16} className="text-yellow-500" />
                        {headerLocation}
                    </div>
                </div>

                <div className="relative z-10 flex items-center gap-4">
                    <button
                        onClick={() => navigate('/destinations')}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-white/5 text-white font-bold rounded-xl border border-gray-700"
                    >
                        <ArrowLeft size={18} /> Back to List
                    </button>
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-emerald-600 disabled:from-gray-700 disabled:to-gray-800 disabled:text-gray-500 text-white font-bold rounded-xl shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:shadow-none"
                    >
                        <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
                        {syncing ? 'Syncing...' : 'Sync & Embed'}
                    </button>
                </div>
            </div>

            {/* Images Gallery */}
            {images.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 md:p-4 shadow-xl">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
                        <ImageIcon size={20} className="text-yellow-500" />
                        Media Gallery
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
                        {images.map((url, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setLightboxIndex(i)}
                                className="relative aspect-square rounded-xl overflow-hidden shadow-md border border-gray-800 cursor-zoom-in"
                            >
                                <AuthenticatedImage
                                    src={url}
                                    alt={`${name} ${i + 1}`}
                                    className="w-full h-full object-cover"
                                />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Main Info Card */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 md:p-4 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-[0.02] pointer-events-none">
                    <Map size={120} className="text-white" />
                </div>

                <h2 className="text-xl font-bold text-white flex items-center gap-3 mb-4 border-b border-gray-800 pb-3">
                    <Info size={24} className="text-blue-500" />
                    Information Data
                    <span className="px-2.5 py-1 rounded-lg bg-yellow-500/10 text-yellow-500 text-xs font-bold border border-yellow-500/20 tracking-wider">READ ONLY</span>
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <Building size={14} /> Destination Name
                        </label>
                        <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium">{name || '-'}</div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <MapPin size={14} /> Address
                        </label>
                        <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium">{address || '-'}</div>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-4 relative z-10">
                    {[
                        ['Province', provinceName],
                        ['Province ID', provinceId],
                        ['District', districtName],
                        ['District ID', districtId],
                        ['Sub-district', subDistrictName],
                        ['Sub-district ID', subDistrictId],
                        ['Postcode', postcode],
                    ].map(([label, value]) => (
                        <div key={label}>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">{label}</label>
                            <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium">{value !== '' && value != null ? value : '-'}</div>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mt-4 relative z-10">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Latitude</label>
                        <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium font-mono text-sm">{lat || 'N/A'}</div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Longitude</label>
                        <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium font-mono text-sm">{lng || 'N/A'}</div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <Clock size={14} /> Opening Hours
                        </label>
                        <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium">{openTime || 'N/A'}</div>
                    </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-800 relative z-10">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Info size={14} /> Description
                    </label>
                    <div className="p-6 bg-black/40 border border-gray-800 rounded-2xl text-gray-300 leading-relaxed whitespace-pre-wrap">
                        {desc || 'ไม่มีข้อมูลรายละเอียด...'}
                    </div>
                </div>

                {(feeRows.length > 0 || feeDetail) && (
                    <div className="mt-4 pt-4 border-t border-gray-800 relative z-10">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <Ticket size={14} /> Admission fee from TAT
                        </label>
                        <div className="p-5 bg-black/40 border border-gray-800 rounded-2xl">
                            {feeRows.length > 0 && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {feeRows.map((row) => (
                                        <div key={row.label} className="flex justify-between gap-3 text-sm bg-black/30 border border-gray-800 rounded-xl px-4 py-3">
                                            <span className="text-gray-400">{row.label}</span>
                                            <span className="text-gray-300 font-bold">{row.value}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {feeDetail && <p className="text-gray-300 text-sm leading-relaxed mt-3 whitespace-pre-wrap">{feeDetail}</p>}
                        </div>
                    </div>
                )}
            </div>

            <ImageLightbox
                images={images}
                currentIndex={lightboxIndex}
                onClose={() => setLightboxIndex(null)}
                onPrevious={() => setLightboxIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1))}
                onNext={() => setLightboxIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1))}
            />
        </div>
    );
};

export default ReadDestination;
