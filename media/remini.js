import FormData from 'form-data';
import { Readable } from 'stream';

export async function remini(imageBuffer, mode = 'enhance') {
  const availableModes = ['enhance', 'recolor', 'dehaze'];
  
  if (!availableModes.includes(mode)) {
    mode = 'enhance';
  }

  const formData = new FormData();
  const apiUrl = `https://inferenceengine.vyro.ai/${mode}`;

  formData.append('model_version', 1, {
    'Content-Transfer-Encoding': 'binary',
    'contentType': 'multipart/form-data; charset=utf-8'
  });

  formData.append('image', Buffer.from(imageBuffer), {
    'filename': 'enhance_image_body.jpg',
    'contentType': 'image/jpeg'
  });

  return new Promise((resolve, reject) => {
    formData.submit({
      'url': apiUrl,
      'host': 'inferenceengine.vyro.ai',
      'path': `/${mode}`,
      'protocol': 'https:',
      'headers': {
        'User-Agent': 'okhttp/4.9.3',
        'Connection': 'Keep-Alive',
        'Accept-Encoding': 'gzip'
      }
    }, (error, response) => {
      if (error) {
        return reject(error);
      }

      const responseData = [];
      
      response.on('data', (chunk) => {
        responseData.push(chunk);
      });

      response.on('end', () => {
        resolve(Buffer.concat(responseData));
      });

      response.on('error', (err) => {
        reject(err);
      });
    });
  });
}

export default { remini };