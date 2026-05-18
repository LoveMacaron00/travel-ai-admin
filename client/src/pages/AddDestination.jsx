import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, X, Maximize2, Minimize2, ImagePlus } from 'lucide-react';
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import 'leaflet/dist/leaflet.css';
import api from '../utils/api';
import { showErrorAlert, showSuccessAlert, showWarningAlert } from '../utils/alerts';
import ImageLightbox from '../components/ImageLightbox';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const PROVINCES = [
    'Bangkok', 'Chiang Mai', 'Chiang Rai', 'Phuket', 'Krabi', 'Ayutthaya',
    'Kanchanaburi', 'Nakhon Ratchasima', 'Chonburi', 'Surat Thani',
    'Nonthaburi', 'Udon Thani', 'Khon Kaen', 'Songkhla', 'Phang Nga',
    'Sukhothai', 'Nan', 'Lampang', 'Mae Hong Son', 'Tak'
];

const QUILL_MODULES = {
    toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link'],
        ['clean']
    ]
};

// Component to recenter map when lat/lng changes
const MapUpdater = ({ lat, lng }) => {
    const map = useMap();
    if (lat && lng) map.setView([lat, lng], map.getZoom());
    return null;
};

const AddDestination = () => {
    const navigate = useNavigate();
    const fileInputRef = useRef(null);

    const [form, setForm] = useState({
        name: '', province: '', description: '',
        latitude: '', longitude: '',
        opening_time: '09:00', closing_time: '17:00',
        status: 'published'
    });
    const [images, setImages] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [mapExpanded, setMapExpanded] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(null);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape' && lightboxIndex == null) {
                navigate('/destinations');
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [lightboxIndex, navigate]);

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
    };

    // -----------------------
    // Map helpers
    // -----------------------
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    const hasValidCoords = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
    const mapCenter = useMemo(() => hasValidCoords ? [lat, lng] : [13.7563, 100.5018], [lat, lng, hasValidCoords]);

    // -----------------------
    // Image Upload
    // -----------------------
    const uploadFiles = useCallback(async (files) => {
        if (files.length === 0) return;
        setUploading(true);
        try {
            const formData = new FormData();
            Array.from(files).forEach(f => formData.append('images', f));

            const res = await api.post('/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (res.data.urls) {
                setImages(prev => [...prev, ...res.data.urls]);
            }
        } catch (err) {
            console.error('Upload error:', err);
            await showErrorAlert('อัปโหลดไม่สำเร็จ');
        }
        setUploading(false);
    }, []);

    const handleFileSelect = (e) => {
        uploadFiles(e.target.files);
        e.target.value = '';
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        const files = e.dataTransfer.files;
        if (files.length > 0) uploadFiles(files);
    };

    const removeImage = (index) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    // -----------------------
    // Submit
    // -----------------------
    const handleSubmit = async () => {
        if (!form.name) {
            await showWarningAlert('กรุณากรอกชื่อสถานที่');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                ...form,
                image_url: images[0] || '',
                images: images
            };
            await api.post('/destinations', payload);
            await showSuccessAlert('เพิ่มสถานที่เรียบร้อยแล้ว');
            navigate('/destinations');
        } catch (err) {
            console.error('เกิดข้อผิดพลาด:', err);
            await showErrorAlert(err.response?.data?.message || 'เกิดข้อผิดพลาด');
        }
        setSaving(false);
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <p className="text-sm text-gray-500">Home &gt; Destinations</p>
                    <h1 className="text-2xl font-bold" style={{ color: '#f0a500' }}>Add Destinations</h1>
                </div>
                <button onClick={handleSubmit} disabled={saving} className="btn-gold">
                    {saving ? 'กำลังบันทึก...' : 'Add'}
                </button>
            </div>

            {/* Media Gallery — Multi-image Upload */}
            <div className="card">
                <h2 className="text-lg font-semibold mb-4">Media Gallery</h2>

                {/* Drag & Drop Zone */}
                <div
                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${dragOver ? 'border-yellow-500 bg-yellow-500/5' : 'border-gray-600 hover:border-gray-500'}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        multiple
                        className="hidden"
                        onChange={handleFileSelect}
                    />
                    {uploading ? (
                        <div className="flex flex-col items-center gap-2">
                            <div className="w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-gray-400">กำลังอัปโหลด...</p>
                        </div>
                    ) : (
                        <>
                            <Upload size={36} className="mx-auto text-gray-500 mb-3" />
                            <p className="text-gray-400">Drag & Drop or Click to upload images</p>
                            <p className="text-xs text-gray-500 mt-2">PNG, JPEG, GIF, WebP (max 10MB each, up to 10 files)</p>
                        </>
                    )}
                </div>

                {/* Image Previews */}
                {images.length > 0 && (
                    <div className="flex flex-wrap items-start gap-1 mt-4">
                        {images.map((url, i) => (
                            <div key={i} className="relative group">
                                <button
                                    type="button"
                                    onClick={() => setLightboxIndex(i)}
                                    className="block max-w-[180px] cursor-zoom-in"
                                >
                                    <img src={url} alt={`upload-${i}`} className="block max-w-[180px] h-auto" />
                                </button>
                                {i === 0 && (
                                    <span className="absolute top-1 left-1 text-[10px] bg-yellow-500 text-black px-1.5 py-0.5 rounded font-semibold">
                                        COVER
                                    </span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeImage(i)}
                                    className="absolute top-1 right-1 bg-red-500/80 hover:bg-red-600 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                        {/* Add more button */}
                        <div
                            className="w-[180px] min-h-[180px] rounded-lg border-2 border-dashed border-gray-600 flex flex-col items-center justify-center text-gray-500 cursor-pointer hover:border-gray-500 transition"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <ImagePlus size={24} />
                            <span className="text-xs mt-1">Add more</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Form */}
            <div className="card mb-6">
                <h2 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-3">Admin Override & Extension</h2>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                        <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Destinations Name</label>
                        <input className="input-field" placeholder="Enter destination name"
                            value={form.name} onChange={e => handleChange('name', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Province</label>
                        <select className="input-field" value={form.province} onChange={e => handleChange('province', e.target.value)}>
                            <option value="">Select Province</option>
                            {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>
                </div>

                {/* Rich Text Editor */}
                <div className="mb-4">
                    <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Description</label>
                    <div className="quill-dark">
                        <ReactQuill
                            theme="snow"
                            value={form.description}
                            onChange={(val) => handleChange('description', val)}
                            modules={QUILL_MODULES}
                            placeholder="Enter description..."
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        {/* Coordinates */}
                        <div>
                            <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Coordinates</label>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Latitude</label>
                                    <input className="input-field" type="number" step="any" placeholder="13.7563"
                                        value={form.latitude} onChange={e => handleChange('latitude', e.target.value)} />
                                </div>
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Longitude</label>
                                    <input className="input-field" type="number" step="any" placeholder="100.5018"
                                        value={form.longitude} onChange={e => handleChange('longitude', e.target.value)} />
                                </div>
                            </div>
                        </div>

                        {/* Time Picker */}
                        <div>
                            <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Opening Hours</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="time"
                                    className="input-field flex-1"
                                    value={form.opening_time}
                                    onChange={e => handleChange('opening_time', e.target.value)}
                                />
                                <span className="text-gray-400">to</span>
                                <input
                                    type="time"
                                    className="input-field flex-1"
                                    value={form.closing_time}
                                    onChange={e => handleChange('closing_time', e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Status */}
                        <div>
                            <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Status</label>
                            <select className="input-field" value={form.status} onChange={e => handleChange('status', e.target.value)}>
                                <option value="published">Published</option>
                                <option value="draft">Draft</option>
                            </select>
                        </div>
                    </div>

                    {/* Leaflet Map */}
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => setMapExpanded(!mapExpanded)}
                            className="absolute top-2 right-2 z-[1000] bg-gray-800/80 text-white p-1.5 rounded-lg hover:bg-gray-700 transition"
                            title={mapExpanded ? 'Collapse' : 'Expand'}
                        >
                            {mapExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                        </button>
                        <div className={`rounded-lg overflow-hidden border border-gray-600 transition-all ${mapExpanded ? 'h-[450px]' : 'h-56'}`}>
                            <MapContainer
                                center={mapCenter}
                                zoom={hasValidCoords ? 15 : 6}
                                style={{ height: '100%', width: '100%' }}
                                scrollWheelZoom={true}
                            >
                                <TileLayer
                                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
                                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                />
                                {hasValidCoords && (
                                    <>
                                        <Marker position={[lat, lng]} />
                                        <MapUpdater lat={lat} lng={lng} />
                                    </>
                                )}
                            </MapContainer>
                        </div>
                        {!hasValidCoords && (
                            <p className="text-xs text-gray-500 mt-1 text-center">กรอก Latitude / Longitude เพื่อแสดง Marker บนแผนที่</p>
                        )}
                    </div>
                </div>
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

export default AddDestination;
