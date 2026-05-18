import { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, MapPin, Clock } from 'lucide-react';
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
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <p className="text-sm text-gray-500">Home &gt; Destinations &gt; Read</p>
                    <h1 className="text-2xl font-bold" style={{ color: '#f0a500' }}>Read Destination</h1>
                </div>
                <button onClick={() => navigate('/destinations')} className="flex items-center gap-2 text-gray-400 hover:text-white transition">
                    <ArrowLeft size={18} /> Back
                </button>
            </div>

            {/* Images */}
            {images.length > 0 && (
                <div className="card mb-6">
                    <h2 className="text-lg font-semibold mb-4">Media Gallery</h2>
                    <div className="flex flex-wrap items-start gap-1">
                        {images.slice(0, 6).map((url, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setLightboxIndex(i)}
                                className="block cursor-zoom-in"
                            >
                                <img src={url} alt={`${name} ${i + 1}`} className="block max-w-[220px] h-auto" />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Main Info Card */}
            <div className="card mb-6">
                <h2 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-3">
                    TAT API Data <span className="badge badge-tat ml-2">Read Only</span>
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs text-gray-400 uppercase tracking-wider">Destination Name</label>
                            <div className="input-field mt-1 opacity-80 cursor-not-allowed">{name}</div>
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 uppercase tracking-wider">Province</label>
                            <div className="input-field mt-1 opacity-80 cursor-not-allowed">{province}</div>
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs text-gray-400 uppercase tracking-wider">Latitude</label>
                                <div className="input-field mt-1 opacity-80 cursor-not-allowed">{lat || 'N/A'}</div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-400 uppercase tracking-wider">Longitude</label>
                                <div className="input-field mt-1 opacity-80 cursor-not-allowed">{lng || 'N/A'}</div>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 uppercase tracking-wider flex items-center gap-1">
                                <Clock size={14} /> Opening Hours
                            </label>
                            <div className="input-field mt-1 opacity-80 cursor-not-allowed">{openTime || 'N/A'}</div>
                        </div>
                    </div>
                </div>

                <div className="mt-6">
                    <label className="text-xs text-gray-400 uppercase tracking-wider">Description</label>
                    <div className="input-field mt-1 opacity-80 cursor-not-allowed min-h-[120px] whitespace-pre-wrap text-sm leading-relaxed">
                        {desc || 'ไม่มีข้อมูล'}
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
