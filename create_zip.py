import os
import zipfile

def create_project_zip(source_dir, output_filename):
    # Files and directories to exclude
    exclude_dirs = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', '.expo', 'dist', 'backend/models'}
    exclude_exts = {'.pt', '.pth', '.bin', '.safetensors', '.gguf', '.pyc', '.exe'}
    
    print(f'Creating {output_filename} from {source_dir}')
    
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(source_dir):
            # Modify dirs in-place to skip excluded directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in exclude_exts:
                    continue
                
                file_path = os.path.join(root, file)
                # Ensure we don't zip the output file itself
                if os.path.abspath(file_path) == os.path.abspath(output_filename):
                    continue
                    
                arcname = os.path.relpath(file_path, source_dir)
                try:
                    zipf.write(file_path, arcname)
                except Exception as e:
                    print(f'Error adding {file_path}: {e}')
                    
    print(f'Successfully created {output_filename}')

create_project_zip('.', 'project_archive.zip')
