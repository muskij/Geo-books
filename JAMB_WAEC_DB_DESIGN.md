# JAMB/WAEC CBT Database & API Design

## 1. Database Models (Django/Python)

### Subject Model
```python
from django.db import models

class ExamType(models.TextChoices):
    JAMB = 'JAMB', 'JAMB'
    WAEC = 'WAEC', 'WAEC'
    NECO = 'NECO', 'NECO'

class Subject(models.Model):
    name = models.CharField(max_length=100)
    exam_type = models.CharField(max_length=10, choices=ExamType.choices)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True)  # Lucide icon name
    color = models.CharField(max_length=20, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['exam_type']),
            models.Index(fields=['is_active']),
        ]
        unique_together = ['name', 'exam_type']

    def __str__(self):
        return f"{self.name} ({self.exam_type})"
```

### Question Model
```python
class QuestionType(models.TextChoices):
    MULTIPLE_CHOICE = 'MCQ', 'Multiple Choice'
    THEORY = 'THEORY', 'Theory'

class Question(models.Model):
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name='questions')
    year = models.IntegerField()  # e.g., 2023, 2022
    question_number = models.IntegerField()
    question_text = models.TextField()
    question_image = models.URLField(blank=True, null=True)
    question_type = models.CharField(max_length=10, choices=QuestionType.choices, default=QuestionType.MULTIPLE_CHOICE)
    option_a = models.TextField(blank=True)
    option_b = models.TextField(blank=True)
    option_c = models.TextField(blank=True)
    option_d = models.TextField(blank=True)
    correct_option = models.CharField(max_length=1, blank=True)  # 'A', 'B', 'C', 'D'
    explanation = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['subject', 'year']),
            models.Index(fields=['is_active']),
        ]
        unique_together = ['subject', 'year', 'question_number']

    def __str__(self):
        return f"{self.subject.name} {self.year} Q{self.question_number}"
```

### UserExamSession Model
```python
from django.contrib.auth import get_user_model

User = get_user_model()

class UserExamSession(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='exam_sessions')
    exam_type = models.CharField(max_length=10, choices=ExamType.choices)
    subjects = models.JSONField()  # List of subject names/IDs
    answers = models.JSONField()  # { subject_id: { question_index: answer } }
    scores = models.JSONField(blank=True, null=True)  # { subject_id: score }
    total_score = models.IntegerField(blank=True, null=True)
    total_time = models.IntegerField()  # Total allowed time in seconds
    time_elapsed = models.IntegerField(blank=True, null=True)  # Actual time taken
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(blank=True, null=True)
    is_completed = models.BooleanField(default=False)

    class Meta:
        indexes = [
            models.Index(fields=['user', '-started_at']),
            models.Index(fields=['exam_type']),
            models.Index(fields=['is_completed']),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.exam_type} - {self.started_at.date()}"
```

## 2. API Endpoints (Django REST Framework)

### Question Package Download Endpoint
```python
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
import gzip
import json
from django.core.cache import cache

class ExamPackageDownloadView(APIView):
    """
    Endpoint to download a compressed package of questions for offline use.
    Accepts: POST with { subject_ids: [1,2,3], year: 2023 }
    Returns: Compressed JSON package with all questions and assets.
    """
    
    def post(self, request):
        subject_ids = request.data.get('subject_ids', [])
        year = request.data.get('year')
        
        if not subject_ids or not year:
            return Response(
                {"error": "subject_ids and year are required"},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Check cache first
        cache_key = f"exam_package_{'_'.join(map(str, sorted(subject_ids)))}_year_{year}"
        cached_package = cache.get(cache_key)
        if cached_package:
            return Response(cached_package)
        
        # Fetch questions from DB
        questions = Question.objects.filter(
            subject_id__in=subject_ids,
            year=year,
            is_active=True
        ).select_related('subject').order_by('subject_id', 'question_number')
        
        # Build package structure
        package = {
            "version": "1.0",
            "exam_year": year,
            "subjects": [],
            "generated_at": "2023-06-19T12:00:00Z"
        }
        
        current_subject = None
        subject_questions = []
        
        for q in questions:
            if current_subject != q.subject.id:
                if current_subject is not None:
                    package["subjects"].append({
                        "id": current_subject.id,
                        "name": current_subject.name,
                        "exam_type": current_subject.exam_type,
                        "questions": subject_questions
                    })
                current_subject = q.subject
                subject_questions = []
            
            subject_questions.append({
                "id": q.id,
                "question_number": q.question_number,
                "text": q.question_text,
                "image": q.question_image,
                "type": q.question_type,
                "options": {
                    "A": q.option_a,
                    "B": q.option_b,
                    "C": q.option_c,
                    "D": q.option_d
                },
                "correct": q.correct_option,
                "explanation": q.explanation
            })
        
        # Add last subject
        if current_subject is not None:
            package["subjects"].append({
                "id": current_subject.id,
                "name": current_subject.name,
                "exam_type": current_subject.exam_type,
                "questions": subject_questions
            })
        
        # Compress the package
        package_json = json.dumps(package)
        compressed = gzip.compress(package_json.encode('utf-8'))
        
        response = Response(compressed)
        response['Content-Type'] = 'application/gzip'
        response['Content-Disposition'] = f'attachment; filename="exam_package_{year}.gz"'
        
        # Cache for 1 hour
        cache.set(cache_key, response.data, 3600)
        
        return response
```

### URLs Configuration
```python
from django.urls import path
from . import views

urlpatterns = [
    path('api/v1/exams/package-download/', views.ExamPackageDownloadView.as_view(), name='package-download'),
    # Other endpoints...
]
```

## 3. Frontend Integration (PWA Service Worker)
```javascript
// service-worker.js - PWA Service Worker for offline caching

self.addEventListener('install', (event) => {
  console.log('Service worker installing...');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service worker activating...');
  event.waitUntil(clients.claim());
});

// Cache exam packages
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/api/v1/exams/package-download/')) {
    event.respondWith(
      caches.open('exam-packages').then((cache) => {
        return fetch(event.request).then((response) => {
          cache.put(event.request, response.clone());
          return response;
        }).catch(() => {
          return cache.match(event.request);
        });
      })
    );
  }
});
```

## 4. IndexedDB Schema for Offline Storage
```javascript
// IndexedDB database schema for storing offline exam packages

const DB_NAME = 'GeoBooksCBT';
const DB_VERSION = 1;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create packages store
      if (!db.objectStoreNames.contains('packages')) {
        const packageStore = db.createObjectStore('packages', { keyPath: 'id' });
        packageStore.createIndex('year', 'year', { unique: false });
        packageStore.createIndex('subjects', 'subjects', { unique: false, multiEntry: true });
      }
      
      // Create sessions store
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id' });
      }
    };
  });
}
```

## Key Features:
- Indexes for fast querying by subject, year, and active status
- Compressed JSON package for efficient download
- Caching on both server and client
- PWA-compatible offline storage
- Comprehensive session tracking
