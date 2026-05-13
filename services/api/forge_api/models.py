from pydantic import BaseModel, Field
from typing import Optional, List
from enum import Enum
from datetime import datetime


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class JobStage(str, Enum):
    EXTRACT = "extract"
    INPAINT = "inpaint"
    LIGHT = "light"
    REMBG = "rembg"
    PACK = "pack"


class WatermarkBox(BaseModel):
    x: float = Field(..., ge=0, le=1)
    y: float = Field(..., ge=0, le=1)
    w: float = Field(..., ge=0, le=1)
    h: float = Field(..., ge=0, le=1)


class Layout(BaseModel):
    cols: int = Field(default=8, ge=1, le=32)
    padding: int = Field(default=2, ge=0, le=20)


class CreateJobRequest(BaseModel):
    video_id: str
    timestamps_ms: List[float]
    remove_bg: bool = True
    watermark_box: Optional[WatermarkBox] = None
    layout: Layout = Layout()


class VideoMeta(BaseModel):
    id: str
    filename: str
    duration_ms: float
    fps: float
    width: int
    height: int
    created_at: datetime


class VideoUploadResponse(BaseModel):
    video_id: str
    duration_ms: float
    fps: float
    width: int
    height: int
    url: str


class ExtractFramesRequest(BaseModel):
    timestamps_ms: List[float]


class ExtractedFramePreview(BaseModel):
    ts_ms: int
    url: str


class ExtractFramesResponse(BaseModel):
    frames: List[ExtractedFramePreview]


class ImageMeta(BaseModel):
    id: str
    filename: str
    width: int
    height: int
    created_at: datetime


class ImageUploadResponse(BaseModel):
    image_id: str
    width: int
    height: int
    url: str


class SegmentBox(BaseModel):
    x: int = Field(..., ge=0)
    y: int = Field(..., ge=0)
    w: int = Field(..., gt=0)
    h: int = Field(..., gt=0)


class DetectedSegment(BaseModel):
    index: int
    box: SegmentBox


class DetectSegmentsResponse(BaseModel):
    segments: List[DetectedSegment]


class CreateImageJobRequest(BaseModel):
    image_id: str
    boxes: List[SegmentBox]
    remove_bg: bool = True
    layout: Layout = Layout()


class JobResponse(BaseModel):
    job_id: str
    status: JobStatus


class FrameInfo(BaseModel):
    index: int
    ts_ms: int
    x: int
    y: int
    w: int
    h: int


class SpritesheetMeta(BaseModel):
    image: str
    frame_size: dict
    padding: int
    cols: int
    rows: int
    frames: List[FrameInfo]


class JobStatusResponse(BaseModel):
    id: str
    video_id: str
    status: JobStatus
    progress: float
    stage: str
    params: CreateJobRequest
    error: Optional[str] = None
    created_at: datetime
    finished_at: Optional[datetime] = None
    result: Optional[dict] = None


class ImageJobStatusResponse(BaseModel):
    id: str
    image_id: str
    status: JobStatus
    progress: float
    stage: str
    params: CreateImageJobRequest
    error: Optional[str] = None
    created_at: datetime
    finished_at: Optional[datetime] = None
    result: Optional[dict] = None


class JobProgress(BaseModel):
    stage: str
    progress: float
    message: Optional[str] = None
    status: Optional[JobStatus] = None
    error: Optional[str] = None
