import { useEffect, useState } from 'react';
import { Plus, Trash2, Edit, MapPin } from 'lucide-react';
import api from '../utils/api';
import { showConfirmAlert, showErrorAlert, showSuccessAlert } from '../utils/alerts';

const CMS = () => {
    const [attractions, setAttractions] = useState([]);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [newAttraction, setNewAttraction] = useState({ name: '', location: '', description: ''});

    const fetchAttractions = async () => {
        try {
            const res = await api.get('/attractions');
            setAttractions(res.data);
        } catch (err) {
            console.error('Error fetching attractions:', err);
        }
    };

    useEffect(() => {
        fetchAttractions();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await api.post('/attractions', newAttraction);
            setIsFormOpen(false);
            setNewAttraction({ name: '', location: '', description: '' });
            fetchAttractions();
        } catch (err) {
            console.error('Error adding attraction:', err);
        }
    };

    const handleDelete = async (id) => {
        const result = await showConfirmAlert({
            title: 'ลบรายการนี้?',
            text: 'การลบจะไม่สามารถกู้คืนได้',
            confirmButtonText: 'ลบรายการ',
            cancelButtonText: 'ยกเลิก'
        });

        if (!result.isConfirmed) return;

        try {
            await api.delete(`/attractions/${id}`);
            fetchAttractions();
            await showSuccessAlert('ลบข้อมูลเรียบร้อยแล้ว');
        } catch (err) {
            console.error('Error deleting attraction:', err);
            await showErrorAlert('ลบข้อมูลไม่สำเร็จ');
        }
    };

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold text-gray-800">Content Management</h1>
                <button
                    onClick={() => setIsFormOpen(true)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
                >
                    <Plus size={20} /> Add Attraction
                </button>
            </div>

            {isFormOpen && (
                <div className="mb-8 bg-white p-6 rounded-xl shadow-lg border border-gray-100">
                    <h2 className="text-xl font-semibold mb-4">Add New Location</h2>
                    <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input
                            className="border p-2 rounded"
                            placeholder="Name"
                            value={newAttraction.name}
                            onChange={e => setNewAttraction({ ...newAttraction, name: e.target.value })}
                            required
                        />
                        <input
                            className="border p-2 rounded"
                            placeholder="Location"
                            value={newAttraction.location}
                            onChange={e => setNewAttraction({ ...newAttraction, location: e.target.value })}
                        />
                 
                        <textarea
                            className="border p-2 rounded md:col-span-2"
                            placeholder="Description"
                            value={newAttraction.description}
                            onChange={e => setNewAttraction({ ...newAttraction, description: e.target.value })}
                        />
                        <div className="md:col-span-2 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setIsFormOpen(false)}
                                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                            >
                                Save Location
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {attractions.map(attraction => (
                    <div key={attraction._id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition">
                        <div className="h-40 bg-gray-200 flex items-center justify-center">
                            {attraction.imageUrl ? (
                                <img src={attraction.imageUrl} alt={attraction.name} className="w-full h-full object-cover" />
                            ) : (
                                <MapPin size={40} className="text-gray-400" />
                            )}
                        </div>
                        <div className="p-4">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="text-lg font-bold text-gray-900">{attraction.name}</h3>
                            </div>
                            <p className="text-sm text-gray-500 mb-4 line-clamp-2">{attraction.description}</p>

                            <div className="flex justify-between items-center pt-2 border-t border-gray-50">
                                <span className="text-xs text-gray-400">{new Date(attraction.createdAt).toLocaleDateString()}</span>
                                <div className="flex gap-2">
                                    <button className="p-1.5 text-blue-600 hover:bg-blue-50 rounded" title="Edit">
                                        <Edit size={16} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(attraction._id)}
                                        className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                                        title="Delete"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {attractions.length === 0 && !isFormOpen && (
                <div className="text-center py-12 text-gray-500">
                    No attractions found. Add one to get started.
                </div>
            )}
        </div>
    );
};

export default CMS;
