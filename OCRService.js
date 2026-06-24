// ===== OCR SERVICE =====
// This file sends captured photo data to OCR API and returns recognized text

const OCR_API_URL = 'https://api.ocr.space/parse/image';
const OCR_API_KEY = 'helloworld';

// Send base64 photo to OCR API
export async function readTextFromImage(photoBase64) {
  const formData = new FormData();

  formData.append('base64Image', `data:image/jpeg;base64,${photoBase64}`);
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');
  formData.append('scale', 'true');
  formData.append('OCREngine', '2');

  const response = await fetch(OCR_API_URL, {
    method: 'POST',
    headers: {
      apikey: OCR_API_KEY,
    },
    body: formData,
  });

  const data = await response.json();

  if (data.IsErroredOnProcessing) {
    throw new Error(data.ErrorMessage?.[0] || 'OCR processing failed');
  }

  return data.ParsedResults?.[0]?.ParsedText || '';
}