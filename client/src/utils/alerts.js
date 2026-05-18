import Swal from 'sweetalert2';

const baseOptions = {
    background: '#111827',
    color: '#f9fafb',
    confirmButtonColor: '#f0a500',
    cancelButtonColor: '#4b5563',
    reverseButtons: true
};

export const showErrorAlert = (text, title = 'เกิดข้อผิดพลาด') => Swal.fire({
    ...baseOptions,
    icon: 'error',
    title,
    text
});

export const showSuccessAlert = (text, title = 'สำเร็จ') => Swal.fire({
    ...baseOptions,
    icon: 'success',
    title,
    text
});

export const showWarningAlert = (text, title = 'กรุณาตรวจสอบข้อมูล') => Swal.fire({
    ...baseOptions,
    icon: 'warning',
    title,
    text
});

export const showConfirmAlert = ({
    title,
    text,
    confirmButtonText = 'ยืนยัน',
    cancelButtonText = 'ยกเลิก',
    icon = 'warning'
}) => Swal.fire({
    ...baseOptions,
    icon,
    title,
    text,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText
});
