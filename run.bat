@echo off
echo ========================================
echo News Sentiment Scanner - Setup Script
echo ========================================
echo.

REM Check if virtual environment exists
if not exist ".venv" (
    echo Virtual environment not found. Creating .venv...
    python -m venv .venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment.
        echo Please ensure Python is installed and accessible.
        pause
        exit /b 1
    )
    echo Virtual environment created successfully!
) else (
    echo Virtual environment found.
)

echo.
echo Activating virtual environment...
call .venv\Scripts\activate.bat

echo.
echo Upgrading pip...
python -m pip install --upgrade pip --quiet

echo.
echo Installing requirements...
echo This may take a few minutes, especially for large packages like PyTorch...
pip install --default-timeout=1000 -r requirements.txt

if errorlevel 1 (
    echo.
    echo ERROR: Failed to install requirements.
    echo Please check your internet connection and try again.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Setup completed successfully!
echo ========================================
echo.
echo Running main.py...
echo.
python main.py

if errorlevel 1 (
    echo.
    echo ERROR: Failed to run main.py
    echo Please check the error messages above.
    pause
    exit /b 1
)

echo.
echo ========================================
echo Program completed!
echo ========================================
echo.
pause

