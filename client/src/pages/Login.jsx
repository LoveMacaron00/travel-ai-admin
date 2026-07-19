import { useState } from 'react';
import api from '../utils/api';
import { showSuccessAlert, showErrorAlert } from '../utils/alerts';

const Login = ({ onLogin }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await api.post('/auth/login', { email, password });
            const data = res.data;

            localStorage.setItem('admin', JSON.stringify(data.admin));
            localStorage.setItem('adminToken', data.token);
            await showSuccessAlert('เข้าสู่ระบบสำเร็จ', 'ยินดีต้อนรับ');
            onLogin(data.admin);
        } catch (err) {
            let message = 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้';
            if (err.response) {
                message = err.response.data?.message || 'เกิดข้อผิดพลาด';
            }
            setError(message);
            showErrorAlert(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: '#464666' }}>
            <div className="w-full max-w-md px-8">
                {/* Logo */}
                <h1 className="text-center text-4xl font-bold mb-12" style={{ color: '#f0a500'}}>
                    GoThai
                </h1>

                <form onSubmit={handleSubmit} className="space-y-6">
                    {/* Email */}
                    <div>
                        <label className="block text-sm text-gray-300 mb-2">อีเมล</label>
                        <input
                            type="text"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            className="w-full bg-transparent border-b border-gray-400 text-white py-2 px-1 outline-none focus:border-yellow-500 transition text-lg"
                            required
                        />
                    </div>

                    {/* Password */}
                    <div>
                        <label className="block text-sm text-gray-300 mb-2">รหัสผ่าน</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            className="w-full bg-transparent border-b border-gray-400 text-white py-2 px-1 outline-none focus:border-yellow-500 transition text-lg"
                            required
                        />
                    </div>

                    {/* Error */}
                    {error && (
                        <p className="text-red-400 text-sm text-center">{error}</p>
                    )}

                    {/* Submit */}
                    <div className="pt-6 flex justify-center">
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-16 py-3 font-semibold text-lg rounded"
                            style={{ background: '#f0a500', color: '#000' }}
                        >
                            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Login;
