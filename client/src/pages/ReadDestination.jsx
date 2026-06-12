import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, MapPin, Clock, Info, Image as ImageIcon, Map, Building } from 'lucide-react';
import api from '../utils/api';
import ImageLightbox from '../components/ImageLightbox';

const ReadDestination = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const navIntroduction = location.state?.introduction || '';
    const [place, setPlace] = useState(null);
    const [loading, setLoading] = useState(true);
    const [lightboxIndex, setLightboxIndex] = useState(null);

    useEffect(() => {
        const fetchPlace = async () => {
            try {
                const res = await api.get(`/v2/places/${id}`);
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

    if (loading) return <div className="p-6 text-gray-400">กำลังโหลดข้อมูล...</div>;
    if (!place) return <div className="p-6 text-gray-400">ไม่พบข้อมูลสถานที่</div>;

    const name = place.place_name || place.placeName || place.name || '';

    // Helper to safely extract name
    const extractName = (val) => {
        if (!val) return '';
        if (typeof val === 'string') return val;
        if (Array.isArray(val)) return val[0] || '';
        if (typeof val === 'object') return val.name || val.provinceName || val.province_name || '';
        return '';
    };

    // Fix: Handle province/district/subDistrict
    const provName = extractName(place.province) || place.province_name || place.provinceName || extractName(place.location?.province);
    const distName = extractName(place.district) || place.district_name || extractName(place.location?.district);
    const subDistName = extractName(place.subDistrict) || place.sub_district || extractName(place.location?.subDistrict);

    const locationParts = [subDistName, distName, provName].filter(Boolean);
    const province = locationParts.length > 0 ? locationParts.join(', ') : 'Unknown Location';

    const desc = place.introduction || place.sha?.detail || place.place_information?.detail || place.detail || place.description || navIntroduction || '';
    const lat = place.latitude || place.location?.latitude || '';
    const lng = place.longitude || place.location?.longitude || '';

    // Fix: Handle opening_hours object or array
    let hours = place.opening_hours;
    let openTime = '';

    if (hours) {
        if (typeof hours === 'string') {
            openTime = hours;
        } else if (Array.isArray(hours)) {
            // Example: [{day: 'Mon', open: '08:00', close: '17:00'}, ...]
            openTime = hours.map(h => {
                if (typeof h === 'string') return h;
                const d = h.day || h.weekday || '';
                const t = h.time || (h.open && h.close ? `${h.open} - ${h.close}` : '');
                return d ? `${d}: ${t}` : t;
            }).filter(Boolean).join(', ');
        } else if (typeof hours === 'object') {
            if (hours.day && Array.isArray(hours.day)) {
                openTime = hours.day[0]?.time || 'N/A';
            } else if (hours.open && hours.close) {
                openTime = `${hours.open} - ${hours.close}`;
            } else {
                // Try to print keys if it's a simple object map
                openTime = Object.entries(hours).map(([k, v]) => `${k}: ${v}`).join(', ');
            }
        }
    }
    const rawImages = place.sha?.detailPicture || place.thumbnailUrl || place.web_picture_urls || place.picture_urls || [];
    const images = Array.isArray(rawImages) ? rawImages : (typeof rawImages === 'string' ? [rawImages] : []);

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 bg-gradient-to-r from-gray-900 to-gray-800 p-8 rounded-3xl border border-gray-800 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-yellow-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
                <div className="absolute bottom-0 left-10 w-40 h-40 bg-blue-500/5 rounded-full blur-2xl -mb-10 pointer-events-none" />

                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-3">
                        <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-bold tracking-widest uppercase border border-blue-500/20">Destination Details</span>
                    </div>
                    <h1 className="text-3xl font-extrabold text-white tracking-tight">
                        {name || 'Loading...'}
                    </h1>
                    <div className="flex items-center gap-2 text-gray-400 mt-2 text-sm font-medium">
                        <MapPin size={16} className="text-yellow-500" />
                        {province}
                    </div>
                </div>

                <button 
                    onClick={() => navigate('/destinations')} 
                    className="relative z-10 flex items-center justify-center gap-2 px-6 py-3 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all border border-gray-700 hover:border-gray-600"
                >
                    <ArrowLeft size={18} /> Back to List
                </button>
            </div>

            {/* Images Gallery */}
            {images.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-3xl p-6 shadow-xl">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2 mb-6">
                        <ImageIcon size={20} className="text-yellow-500" />
                        Media Gallery
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                        {images.slice(0, 6).map((url, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setLightboxIndex(i)}
                                className="group relative aspect-square rounded-2xl overflow-hidden shadow-md border border-gray-800 hover:border-yellow-500/50 transition-all cursor-zoom-in"
                            >
                                <img 
                                    src={url} 
                                    alt={`${name} ${i + 1}`} 
                                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" 
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                                    <div className="opacity-0 group-hover:opacity-100 transform translate-y-4 group-hover:translate-y-0 transition-all">
                                        <ImageIcon size={24} className="text-white drop-shadow-md" />
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Main Info Card */}
            <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-[0.02] pointer-events-none">
                    <Map size={120} className="text-white" />
                </div>
                
                <h2 className="text-xl font-bold text-white flex items-center gap-3 mb-8 border-b border-gray-800 pb-4">
                    <Info size={24} className="text-blue-500" />
                    Information Data
                    <span className="px-2.5 py-1 rounded-lg bg-yellow-500/10 text-yellow-500 text-xs font-bold border border-yellow-500/20 tracking-wider">READ ONLY</span>
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-8 relative z-10">
                    <div className="space-y-6">
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                <Building size={14} /> Destination Name
                            </label>
                            <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium">{name || '-'}</div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                <MapPin size={14} /> Province / Location
                            </label>
                            <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium">{province || '-'}</div>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="grid grid-cols-2 gap-6">
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Latitude</label>
                                <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium font-mono text-sm">{lat || 'N/A'}</div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">Longitude</label>
                                <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium font-mono text-sm">{lng || 'N/A'}</div>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                <Clock size={14} /> Opening Hours
                            </label>
                            <div className="p-4 bg-black/40 border border-gray-800 rounded-xl text-gray-300 font-medium">{openTime || 'N/A'}</div>
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-8 border-t border-gray-800 relative z-10">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <Info size={14} /> Description & Details
                    </label>
                    <div className="p-6 bg-black/40 border border-gray-800 rounded-2xl text-gray-300 leading-relaxed whitespace-pre-wrap">
                        {desc || 'ไม่มีข้อมูลรายละเอียด...'}
                    </div>
                </div>
            </div>

            <ImageLightbox
                images={images.slice(0, 6)}
                currentIndex={lightboxIndex}
                onClose={() => setLightboxIndex(null)}
                onPrevious={() => setLightboxIndex((prev) => (prev === 0 ? images.slice(0, 6).length - 1 : prev - 1))}
                onNext={() => setLightboxIndex((prev) => (prev === images.slice(0, 6).length - 1 ? 0 : prev + 1))}
            />
        </div>
    );
};

export default ReadDestination;
